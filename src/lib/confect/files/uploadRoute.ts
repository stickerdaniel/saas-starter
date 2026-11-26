import { storeFile } from '@convex-dev/agent';
import { ConvexError } from 'convex/values';
import { components, internal } from '../../convex/_generated/api';
import type { ActionCtx } from '../../convex/_generated/server';
import { UPLOAD_PROFILES, type UploadProfile } from '../../uploads/profiles';
import { buildTrustedOrigins } from '../authServer';
import { SUPPORT_ERROR_CODES } from '../support/errors';
import { createFileError, FILE_ERROR_CODES } from './errors';
import { validateUploadBlob } from './upload';

export type UploadPurpose = 'aiChat' | 'support' | 'profileImage';

const PROFILES: Record<UploadPurpose, UploadProfile> = {
	aiChat: UPLOAD_PROFILES.chatAttachment,
	support: UPLOAD_PROFILES.chatAttachment,
	profileImage: UPLOAD_PROFILES.profileImage
};

const REFUSAL_STATUS = {
	Unauthenticated: 401,
	[SUPPORT_ERROR_CODES.authenticationRequired]: 401,
	UPLOAD_ORIGIN_FORBIDDEN: 403,
	[FILE_ERROR_CODES.tooLarge]: 413,
	[FILE_ERROR_CODES.typeNotAllowed]: 415,
	RATE_LIMITED: 429,
	[FILE_ERROR_CODES.uploadRateLimited]: 429,
	[FILE_ERROR_CODES.storageUnavailable]: 500
} as const;

type RefusalCode = keyof typeof REFUSAL_STATUS;

const REFUSAL_CODES = new Set<unknown>(Object.keys(REFUSAL_STATUS));

const isRefusalCode = (code: unknown): code is RefusalCode => REFUSAL_CODES.has(code);

const refuse = (code: RefusalCode, cors: HeadersInit, retryAfter?: number) =>
	Response.json(retryAfter === undefined ? { code } : { code, retryAfter }, {
		status: REFUSAL_STATUS[code],
		headers: cors
	});

function refusalOf(error: unknown, cors: HeadersInit): Response | undefined {
	if (!(error instanceof ConvexError)) return undefined;
	const data: unknown = error.data;
	const fields = typeof data === 'object' && data !== null ? data : undefined;
	const code = fields && 'code' in fields ? fields.code : data;
	if (!isRefusalCode(code)) return undefined;
	const retryAfter =
		fields && 'retryAfter' in fields && typeof fields.retryAfter === 'number'
			? fields.retryAfter
			: undefined;
	return refuse(code, cors, retryAfter);
}

const UPLOAD_HEADERS = 'Authorization, Content-Type, X-Anonymous-User-Id';
const VARY_ORIGIN = { Vary: 'Origin' };

function corsFor(request: Request): HeadersInit | undefined {
	const origin = request.headers.get('Origin');
	if (origin === null) return VARY_ORIGIN;
	return buildTrustedOrigins().includes(origin)
		? { ...VARY_ORIGIN, 'Access-Control-Allow-Origin': origin }
		: undefined;
}

export function uploadPreflight(request: Request): Response {
	const cors = corsFor(request);
	if (cors === undefined) return refuse('UPLOAD_ORIGIN_FORBIDDEN', VARY_ORIGIN);
	return new Response(null, {
		status: 204,
		headers: {
			...cors,
			'Access-Control-Allow-Methods': 'POST',
			'Access-Control-Allow-Headers': UPLOAD_HEADERS
		}
	});
}

const acceptedToken = (ctx: ActionCtx) =>
	ctx.auth.getUserIdentity().then(
		(identity) => identity !== null,
		() => false
	);

const authorize = (ctx: ActionCtx, request: Request, purpose: UploadPurpose) => {
	switch (purpose) {
		case 'aiChat':
			return ctx.runMutation(internal.aiChat.files.authorizeUpload, {});
		case 'support': {
			const anonymousUserId = request.headers.has('Authorization')
				? undefined
				: (request.headers.get('X-Anonymous-User-Id') ?? undefined);
			return ctx.runMutation(internal.support.files.authorizeUpload, { anonymousUserId });
		}
		case 'profileImage':
			return ctx.runMutation(internal.storage.authorizeUpload, {});
	}
};

async function readWithin(body: Request['body'], maxBytes: number) {
	if (body === null) return [];
	const reader = body.getReader();
	const chunks: Array<Uint8Array<ArrayBuffer>> = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return chunks;
		received += value.byteLength;
		if (received > maxBytes) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
}

function dimension(value: string | null): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function storeChatAttachment(
	ctx: ActionCtx,
	ownerId: string,
	blob: Blob,
	query: URLSearchParams
) {
	const mimeType = validateUploadBlob(blob, undefined);
	const isImage = mimeType.startsWith('image/');
	const { file } = await storeFile(ctx, components.agent, blob, {
		filename: query.get('filename') ?? undefined
	});
	await ctx.runMutation(internal.files.owners.record, { fileId: file.fileId, ownerId });
	const width = dimension(query.get('width'));
	const height = dimension(query.get('height'));
	if (isImage && width !== undefined && height !== undefined) {
		await ctx.runMutation(internal.files.metadata.storeFileMetadata, {
			fileId: file.fileId,
			storageId: file.storageId,
			url: file.url,
			width,
			height
		});
	}
	return { fileId: file.fileId, url: file.url, filename: file.filename, isImage };
}

async function discardStaged(ctx: ActionCtx, storageId: string) {
	try {
		await ctx.runAction(components.convexFilesControl.cleanUp.deleteStorageFile, {
			storageId,
			storageProvider: 'convex'
		});
	} catch {
		console.error('Staged profile image cleanup failed');
	}
}

async function storeProfileImage(ctx: ActionCtx, blob: Blob) {
	validateUploadBlob(blob, undefined, UPLOAD_PROFILES.profileImage);
	const { uploadUrl, uploadToken } = await ctx.runMutation(
		components.convexFilesControl.upload.generateUploadUrl,
		{ provider: 'convex' }
	);
	const posted = await fetch(uploadUrl, {
		method: 'POST',
		headers: { 'Content-Type': blob.type },
		body: blob
	});
	const answer: unknown = posted.ok ? await posted.json() : undefined;
	const storageId =
		typeof answer === 'object' && answer !== null && 'storageId' in answer
			? answer.storageId
			: undefined;
	if (typeof storageId !== 'string') throw createFileError(FILE_ERROR_CODES.storageUnavailable);
	try {
		const url = await ctx.runMutation(internal.storage.finalizeProfileImage, {
			storageId,
			uploadToken
		});
		return { url };
	} catch (error) {
		await discardStaged(ctx, storageId);
		throw error;
	}
}

export const receiveUpload =
	(purpose: UploadPurpose) =>
	async (ctx: ActionCtx, request: Request): Promise<Response> => {
		const cors = corsFor(request);
		if (cors === undefined) return refuse('UPLOAD_ORIGIN_FORBIDDEN', VARY_ORIGIN);
		if (request.headers.has('Authorization') && !(await acceptedToken(ctx))) {
			return refuse('Unauthenticated', cors);
		}
		try {
			const ownerId = await authorize(ctx, request, purpose);
			const { maxBytes } = PROFILES[purpose];
			if (Number(request.headers.get('Content-Length')) > maxBytes) {
				return refuse(FILE_ERROR_CODES.tooLarge, cors);
			}
			const chunks = await readWithin(request.body, maxBytes);
			if (chunks === undefined) return refuse(FILE_ERROR_CODES.tooLarge, cors);
			const blob = new Blob(chunks, { type: request.headers.get('Content-Type') ?? '' });
			const query = new URL(request.url).searchParams;
			const result =
				purpose === 'profileImage'
					? await storeProfileImage(ctx, blob)
					: await storeChatAttachment(ctx, ownerId, blob, query);
			return Response.json(result, { headers: cors });
		} catch (error) {
			const refusal = refusalOf(error, cors);
			if (refusal) return refusal;
			console.error('Upload failed');
			return refuse(FILE_ERROR_CODES.storageUnavailable, cors);
		}
	};
