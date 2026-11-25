import { FunctionImpl, GroupImpl } from '@confect/server';
import { storeFile } from '@convex-dev/agent';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components, internal } from '../../convex/_generated/api';
import type {
	ActionCtx as ConvexActionCtx,
	MutationCtx as ConvexMutationCtx
} from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { ActionCtx, MutationCtx, MutationRunner } from '../_generated/services';
import { FileRefusal } from '../errorCodecs';
import { fetchAttachmentText } from '../files/attachmentText';
import { FILE_ERROR_CODES, createFileError } from '../files/errors';
import { releaseUploadStaging, UPLOAD_STAGING_TTL_MS } from '../files/staging';
import { validateUploadBlob } from '../files/upload';
import RequireUserImpl from '../middleware/RequireUser.impl';
import { CurrentUser } from '../middleware/RequireUser.spec';
import files from './files.spec';
import { aiChatRateLimiter } from './rateLimit';
import type { UploadRegistrationArgsSchema } from './schemas';

type FileBucket = {
	readonly name: 'aiChatFileUpload' | 'aiChatFilePreview';
	readonly code:
		typeof FILE_ERROR_CODES.uploadRateLimited | typeof FILE_ERROR_CODES.previewRateLimited;
};

const limitUser = (ctx: ConvexMutationCtx, { name, code }: FileBucket) =>
	Effect.gen(function* () {
		const { _id: key } = yield* CurrentUser;
		const status = yield* Effect.promise(() => aiChatRateLimiter.limit(ctx, name, { key }));
		if (!status.ok) {
			return yield* Effect.fail(
				new FileRefusal({ refusal: { code, retryAfter: status.retryAfter } })
			);
		}
	});

async function registerUpload(
	ctx: ConvexActionCtx,
	args: typeof UploadRegistrationArgsSchema.Type
) {
	const accessKey = args.accessKey?.trim() || 'ai-chat';
	await ctx.runMutation(components.convexFilesControl.upload.finalizeUpload, {
		uploadToken: args.uploadToken,
		storageId: args.storageId,
		accessKeys: [accessKey],
		expiresAt: Date.now() + UPLOAD_STAGING_TTL_MS
	});

	try {
		const downloadGrant = await ctx.runMutation(
			components.convexFilesControl.download.createDownloadGrant,
			{
				storageId: args.storageId,
				maxUses: 1,
				expiresAt: Date.now() + 5 * 60 * 1000,
				shareableLink: false
			}
		);

		const downloadResult = await ctx.runMutation(
			components.convexFilesControl.download.consumeDownloadGrantForUrl,
			{
				downloadToken: downloadGrant.downloadToken,
				accessKey
			}
		);

		if (downloadResult.status !== 'ok' || !downloadResult.downloadUrl) {
			throw new Error(`Failed to get download URL: ${downloadResult.status}`);
		}

		const response = await fetch(downloadResult.downloadUrl);
		if (!response.ok) {
			throw createFileError(FILE_ERROR_CODES.fetchFailed);
		}
		const blob = await response.blob();
		const verifiedMimeType = validateUploadBlob(blob, args.locale);

		const { file } = await storeFile(ctx, components.agent, blob, {
			filename: args.filename
		});

		if (args.width && args.height && verifiedMimeType.startsWith('image/')) {
			await ctx.runMutation(internal.files.metadata.storeFileMetadata, {
				fileId: file.fileId,
				storageId: file.storageId,
				url: file.url,
				width: args.width,
				height: args.height
			});
		}

		return {
			fileId: file.fileId,
			storageId: file.storageId,
			url: file.url,
			filename: file.filename,
			isImage: verifiedMimeType.startsWith('image/')
		};
	} finally {
		await releaseUploadStaging(ctx, args.storageId);
	}
}

export default GroupImpl.make(databaseSchema, files).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, files, 'checkPreviewAccess', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* limitUser(ctx, {
					name: 'aiChatFilePreview',
					code: FILE_ERROR_CODES.previewRateLimited
				});
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, files, 'generateUploadUrl', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* limitUser(ctx, {
					name: 'aiChatFileUpload',
					code: FILE_ERROR_CODES.uploadRateLimited
				});
				return yield* Effect.promise(() =>
					ctx.runMutation(components.convexFilesControl.upload.generateUploadUrl, {
						provider: 'convex'
					})
				);
			})
		),
		FunctionImpl.make(databaseSchema, files, 'getAttachmentText', ({ url, locale }) =>
			Effect.gen(function* () {
				const mutations = yield* MutationRunner;
				yield* mutations
					.runMutation(refs.internal.aiChat.files.checkPreviewAccess, {})
					.pipe(Effect.catchTag('SchemaError', Effect.die));
				return yield* Effect.promise(() => fetchAttachmentText(url, locale));
			})
		),
		FunctionImpl.make(databaseSchema, files, 'requireFileAccess', () =>
			Effect.gen(function* () {
				yield* CurrentUser;
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, files, 'saveUploadedFile', (args) =>
			Effect.gen(function* () {
				const mutations = yield* MutationRunner;
				yield* mutations
					.runMutation(refs.internal.aiChat.files.requireFileAccess, {})
					.pipe(Effect.catchTag('SchemaError', Effect.die));
				const ctx = yield* ActionCtx;
				return yield* Effect.promise(() => registerUpload(ctx, args));
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
