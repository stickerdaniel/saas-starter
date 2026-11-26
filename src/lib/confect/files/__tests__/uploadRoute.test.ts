// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import rateLimiterSchema from '../../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import filesControl from '@gilhrpenner/convex-files-control/test';
import {
	actionGeneric,
	mutationGeneric,
	type GenericDataModel,
	type GenericMutationCtx
} from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { UPLOAD_PROFILES } from '../../../uploads/profiles';
import { convexModules, preloadModules } from '../../convexTest.modules';
import type { Id } from '../../../convex/_generated/dataModel';
import type { UploadPurpose } from '../uploadRoute';

type Staged = { size: number; contentType: string | null };

const staged = new Map<string, Staged>();
const discarded: string[] = [];

const uploadModulePath = Object.keys(filesControl.modules).find((path) =>
	path.endsWith('/component/upload.ts')
);
if (uploadModulePath === undefined) throw new Error('files-control has no upload module');
const loadUpload = filesControl.modules[uploadModulePath];

filesControl.modules[uploadModulePath] = async () => {
	const upload = (await loadUpload()) as {
		finalizeUpload: {
			_handler: (ctx: GenericMutationCtx<GenericDataModel>, args: object) => Promise<unknown>;
		};
	};
	return {
		...upload,
		finalizeUpload: mutationGeneric({
			args: {
				uploadToken: v.string(),
				storageId: v.string(),
				accessKeys: v.array(v.string()),
				expiresAt: v.optional(v.union(v.null(), v.number()))
			},
			handler: async (ctx, args) => {
				const metadata = staged.get(args.storageId);
				return await upload.finalizeUpload._handler(ctx, {
					...args,
					metadata: metadata && { ...metadata, sha256: 'sha256' }
				});
			}
		})
	};
};

const cleanUpModulePath = Object.keys(filesControl.modules).find((path) =>
	path.endsWith('/component/cleanUp.ts')
);
if (cleanUpModulePath === undefined) throw new Error('files-control has no cleanUp module');
const loadCleanUp = filesControl.modules[cleanUpModulePath];

filesControl.modules[cleanUpModulePath] = async () => ({
	...((await loadCleanUp()) as object),
	deleteStorageFile: actionGeneric({
		args: { storageId: v.string(), storageProvider: v.literal('convex') },
		handler: async (_ctx, { storageId }) => {
			discarded.push(storageId);
			return null;
		}
	})
});

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);
const agentModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);

const DAY = 24 * 60 * 60 * 1000;
const SITE_ORIGIN = 'https://example.test';
const CONVEX_SITE_URL = 'https://site.test';
const UPLOAD_BURST = 10;
const CHUNK_BYTES = 64 * 1024;
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
	t.registerComponent('agent', agentSchema, agentModules);
	filesControl.register(t);
	return t;
};
type Harness = ReturnType<typeof harness>;
type Caller = Pick<Harness, 'fetch' | 'mutation' | 'action'>;

async function signIn(t: Harness, email = 'ada@example.com') {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Ada',
				email,
				emailVerified: true,
				role: 'user',
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId: user._id,
				token: crypto.randomUUID(),
				expiresAt: now + DAY,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return {
		userId: user._id,
		sessionId: session._id,
		caller: t.withIdentity({ subject: user._id, sessionId: session._id })
	};
}

const PURPOSES = {
	aiChat: {
		accepted: () => new Blob(['note'], { type: 'text/plain' }),
		refusedType: 'application/x-msdownload',
		maxBytes: UPLOAD_PROFILES.chatAttachment.maxBytes,
		rateLimitCode: 'FILE_UPLOAD_RATE_LIMITED'
	},
	support: {
		accepted: () => new Blob(['note'], { type: 'text/plain' }),
		refusedType: 'application/x-msdownload',
		maxBytes: UPLOAD_PROFILES.chatAttachment.maxBytes,
		rateLimitCode: 'RATE_LIMITED'
	},
	profileImage: {
		accepted: () => new Blob([PNG_BYTES], { type: 'image/png' }),
		refusedType: 'image/svg+xml',
		maxBytes: UPLOAD_PROFILES.profileImage.maxBytes,
		rateLimitCode: 'RATE_LIMITED'
	}
} satisfies Record<UploadPurpose, unknown>;

const post = (
	caller: Caller,
	purpose: UploadPurpose,
	body: BodyInit | null,
	options: { query?: string; headers?: Record<string, string> } = {}
) =>
	caller.fetch(`/uploads/${purpose}${options.query ?? ''}`, {
		method: 'POST',
		body,
		headers: options.headers
	});

const storageUploads = () => {
	const fetchSpy = vi.mocked(globalThis.fetch);
	return fetchSpy.mock.calls.filter(([input]) => String(input).includes('/api/storage/upload'));
};

async function stored(t: Harness) {
	const appBlobs = await t.run(async (ctx) => await ctx.db.system.query('_storage').take(100));
	const { page: componentFiles } = await t.query(
		components.convexFilesControl.queries.listFilesPage,
		{ paginationOpts: { numItems: 10, cursor: null } }
	);
	return {
		appBlobs: appBlobs.length,
		componentFiles: componentFiles.length,
		staged: storageUploads().length
	};
}

const nothingStored = { appBlobs: 0, componentFiles: 0, staged: 0 };

const grants = (t: Harness) =>
	t.query(components.convexFilesControl.queries.listDownloadGrantsPage, {
		paginationOpts: { numItems: 10, cursor: null }
	});

async function asCaller(t: Harness, purpose: UploadPurpose) {
	if (purpose === 'support') {
		const headers: Record<string, string> = {
			'X-Anonymous-User-Id': `anon_${crypto.randomUUID()}`
		};
		return { caller: t, headers };
	}
	const headers: Record<string, string> = {};
	return { caller: (await signIn(t)).caller, headers };
}

function streamed(totalBytes: number) {
	let pulled = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (pulled >= totalBytes) {
				controller.close();
				return;
			}
			pulled += CHUNK_BYTES;
			controller.enqueue(new Uint8Array(CHUNK_BYTES));
		}
	});
	return { stream, pulled: () => pulled };
}

async function failure(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

beforeEach(() => {
	vi.stubEnv('SITE_URL', SITE_ORIGIN);
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret');
	vi.stubEnv('CONVEX_SITE_URL', CONVEX_SITE_URL);
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		if (!String(input).includes('/api/storage/upload'))
			throw new Error(`Unexpected fetch ${input}`);
		const body = await new Response(init?.body).blob();
		const storageId = crypto.randomUUID();
		staged.set(storageId, {
			size: body.size,
			contentType: new Headers(init?.headers).get('Content-Type')
		});
		return Response.json({ storageId });
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	staged.clear();
	discarded.length = 0;
});

describe('upload route identity', () => {
	it('runs the RequireUser authorization under the identity of the request', async () => {
		const t = harness();
		const { caller } = await signIn(t);

		const response = await post(caller, 'aiChat', PURPOSES.aiChat.accepted());

		expect(response.status).toBe(200);
		expect((await stored(t)).appBlobs).toBe(1);
	});
});

describe.each(Object.keys(PURPOSES) as UploadPurpose[])('POST /uploads/%s', (purpose) => {
	const profile = PURPOSES[purpose];

	it('refuses a request without an identity and stores nothing', async () => {
		const t = harness();
		const { userId } = await signIn(t);

		const response = await post(t, purpose, profile.accepted(), {
			query: `?ownerId=${userId}&userId=${userId}&anonymousUserId=anon_${crypto.randomUUID()}`
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			code: purpose === 'support' ? 'SUPPORT_AUTHENTICATION_REQUIRED' : 'Unauthenticated'
		});
		expect(await stored(t)).toEqual(nothingStored);
	});

	it('refuses a Bearer token the deployment does not accept and stores nothing', async () => {
		const t = harness();
		const { headers } = await asCaller(t, purpose);

		const response = await post(t, purpose, profile.accepted(), {
			headers: { ...headers, Authorization: 'Bearer not-a-convex-token' }
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ code: 'Unauthenticated' });
		expect(await stored(t)).toEqual(nothingStored);
	});

	it('refuses a type outside the profile and stores nothing', async () => {
		const t = harness();
		const { caller, headers } = await asCaller(t, purpose);

		const response = await post(caller, purpose, new Blob(['MZ'], { type: profile.refusedType }), {
			headers
		});

		expect(response.status).toBe(415);
		expect(await response.json()).toEqual({ code: 'FILE_TYPE_NOT_ALLOWED' });
		expect(await stored(t)).toEqual(nothingStored);
	});

	it('answers 429 with the retry delay once the upload bucket is empty', async () => {
		const t = harness();
		const { caller, headers } = await asCaller(t, purpose);
		for (let i = 0; i < UPLOAD_BURST; i++) {
			expect((await post(caller, purpose, profile.accepted(), { headers })).status).toBe(200);
		}
		const before = await stored(t);

		const response = await post(caller, purpose, profile.accepted(), { headers });

		expect(response.status).toBe(429);
		const body = await response.json();
		expect(body).toEqual({ code: profile.rateLimitCode, retryAfter: expect.any(Number) });
		expect(body.retryAfter).toBeGreaterThan(0);
		expect(await stored(t)).toEqual(before);
	});

	it.each([
		['a correct Content-Length', (bytes: number) => ({ 'Content-Length': String(bytes) })],
		['an understated Content-Length', () => ({ 'Content-Length': '10' })]
	])('refuses a body over the cap with %s and stores nothing', async (_label, length) => {
		const t = harness();
		const { caller, headers } = await asCaller(t, purpose);
		const bytes = profile.maxBytes + 1;

		const response = await post(caller, purpose, new Uint8Array(bytes), {
			headers: { ...headers, ...length(bytes), 'Content-Type': profile.accepted().type }
		});

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ code: 'FILE_TOO_LARGE' });
		expect(await stored(t)).toEqual(nothingStored);
	});

	it('stops reading a streamed body shortly after the cap and stores nothing', async () => {
		const t = harness();
		const { caller, headers } = await asCaller(t, purpose);
		const body = streamed(3 * profile.maxBytes);

		const response = await caller.fetch(`/uploads/${purpose}`, {
			method: 'POST',
			body: body.stream,
			headers: { ...headers, 'Content-Type': profile.accepted().type },
			duplex: 'half'
		} as RequestInit);

		expect(response.status).toBe(413);
		expect(body.pulled()).toBeLessThanOrEqual(profile.maxBytes + 2 * CHUNK_BYTES);
		expect(await stored(t)).toEqual(nothingStored);
	});
});

describe('chat attachment uploads', () => {
	it.each(['aiChat', 'support'] as const)(
		'stores one %s file and returns its reference',
		async (purpose) => {
			const t = harness();
			const { caller, headers } = await asCaller(t, purpose);

			const response = await post(
				caller,
				purpose,
				new Blob(['# Notes'], { type: 'text/markdown; charset=utf-8' }),
				{
					headers,
					query: '?filename=notes.md'
				}
			);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({
				fileId: expect.any(String),
				url: expect.any(String),
				filename: 'notes.md',
				isImage: false
			});
			await expect(
				t.query(components.agent.files.get, { fileId: body.fileId })
			).resolves.toMatchObject({
				filename: 'notes.md'
			});
			expect(await stored(t)).toEqual({ ...nothingStored, appBlobs: 1 });
		}
	);

	it('records the dimensions of an image', async () => {
		const t = harness();
		const { caller } = await signIn(t);

		const response = await post(caller, 'aiChat', new Blob([PNG_BYTES], { type: 'image/png' }), {
			query: '?filename=shot.png&width=640&height=480'
		});

		const { url, isImage } = await response.json();
		expect(isImage).toBe(true);
		const rows = await t.run(async (ctx) => await ctx.db.query('fileMetadata').take(10));
		expect(rows).toEqual([expect.objectContaining({ url, width: 640, height: 480 })]);
	});
});

describe('support upload identity', () => {
	it('accepts a well-formed anonymous visitor without a session', async () => {
		const t = harness();

		const response = await post(t, 'support', PURPOSES.support.accepted(), {
			headers: { 'X-Anonymous-User-Id': `anon_${crypto.randomUUID()}` }
		});

		expect(response.status).toBe(200);
	});

	it('refuses a visitor id without the anonymous prefix and stores nothing', async () => {
		const t = harness();

		const response = await post(t, 'support', PURPOSES.support.accepted(), {
			headers: { 'X-Anonymous-User-Id': 'visitor_1' }
		});

		expect(response.status).toBe(401);
		expect(await stored(t)).toEqual(nothingStored);
	});

	it('refuses a token without a live session instead of falling back to the visitor id', async () => {
		const t = harness();
		const { caller, sessionId } = await signIn(t);
		await t.mutation(components.betterAuth.adapter.deleteOne, {
			input: { model: 'session', where: [{ field: '_id', value: sessionId }] }
		});

		const response = await post(caller, 'support', PURPOSES.support.accepted(), {
			headers: {
				Authorization: 'Bearer token-of-the-ended-session',
				'X-Anonymous-User-Id': `anon_${crypto.randomUUID()}`
			}
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ code: 'SUPPORT_AUTHENTICATION_REQUIRED' });
		expect(await stored(t)).toEqual(nothingStored);
	});

	it('limits a signed-in caller by account, not by the anonymous id they send', async () => {
		const t = harness();
		for (let i = 0; i < UPLOAD_BURST; i++) {
			await post(t, 'support', PURPOSES.support.accepted(), {
				headers: { 'X-Anonymous-User-Id': `anon_${i}` }
			});
		}
		expect(
			(
				await post(t, 'support', PURPOSES.support.accepted(), {
					headers: { 'X-Anonymous-User-Id': 'anon_fresh' }
				})
			).status
		).toBe(429);

		const { caller } = await signIn(t);
		const response = await post(caller, 'support', PURPOSES.support.accepted(), {
			headers: { 'X-Anonymous-User-Id': 'anon_fresh' }
		});

		expect(response.status).toBe(200);
	});
});

describe('profile image uploads', () => {
	it.each([...new Set(Object.values(UPLOAD_PROFILES.profileImage.extensions))])(
		'returns an inline avatar URL for %s',
		async (type) => {
			const t = harness();
			const { caller, userId } = await signIn(t);

			const response = await post(caller, 'profileImage', new Blob([PNG_BYTES], { type }));

			const [grant] = (await grants(t)).page;
			expect(await response.json()).toEqual({
				url: `${CONVEX_SITE_URL}/files/inline?token=${grant?._id}`
			});
			expect(grant).toMatchObject({ maxUses: null, expiresAt: null });
			const { page } = await t.query(components.convexFilesControl.queries.listFilesPage, {
				paginationOpts: { numItems: 10, cursor: null }
			});
			expect(page).toEqual([expect.objectContaining({ expiresAt: null })]);
			expect(discarded).toEqual([]);
			await expect(
				t.query(components.convexFilesControl.queries.hasAccessKey, {
					storageId: page[0]!.storageId,
					accessKey: userId
				})
			).resolves.toBe(true);
		}
	);

	it('refuses a body without a type before staging it', async () => {
		const t = harness();
		const { caller } = await signIn(t);

		const response = await post(caller, 'profileImage', new Blob([PNG_BYTES]));

		expect(response.status).toBe(415);
		expect(await stored(t)).toEqual(nothingStored);
	});

	it('answers 500 without a site URL, issues no grant and deletes the staged blob', async () => {
		const t = harness();
		const { caller } = await signIn(t);
		vi.stubEnv('CONVEX_SITE_URL', '');
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await post(caller, 'profileImage', PURPOSES.profileImage.accepted());

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ code: 'FILE_STORAGE_UNAVAILABLE' });
		expect((await grants(t)).page).toEqual([]);
		const { page } = await t.query(components.convexFilesControl.queries.listFilesPage, {
			paginationOpts: { numItems: 10, cursor: null }
		});
		expect(page).toEqual([]);
		expect(discarded).toEqual([...staged.keys()]);
		expect(discarded).toHaveLength(1);
	});
});

describe('upload route CORS', () => {
	it.each(['OPTIONS', 'POST'])(
		'refuses a foreign origin on %s and stores nothing',
		async (method) => {
			const t = harness();
			const { caller } = await signIn(t);

			const response = await caller.fetch('/uploads/aiChat', {
				method,
				body: method === 'POST' ? PURPOSES.aiChat.accepted() : null,
				headers: { Origin: 'https://evil.test' }
			});

			expect(response.status).toBe(403);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
			expect(response.headers.get('Vary')).toBe('Origin');
			expect(await stored(t)).toEqual(nothingStored);
		}
	);

	it('gives the site origin the headers its uploads need', async () => {
		const t = harness();
		const { caller } = await signIn(t);

		const preflight = await caller.fetch('/uploads/support', {
			method: 'OPTIONS',
			headers: { Origin: SITE_ORIGIN, 'Access-Control-Request-Method': 'POST' }
		});
		const upload = await post(caller, 'aiChat', PURPOSES.aiChat.accepted(), {
			headers: { Origin: SITE_ORIGIN }
		});

		expect(preflight.status).toBe(204);
		expect(Object.fromEntries(preflight.headers)).toMatchObject({
			'access-control-allow-origin': SITE_ORIGIN,
			vary: 'Origin',
			'access-control-allow-methods': 'POST',
			'access-control-allow-headers': 'Authorization, Content-Type, X-Anonymous-User-Id'
		});
		expect(upload.status).toBe(200);
		expect(upload.headers.get('Access-Control-Allow-Origin')).toBe(SITE_ORIGIN);
		expect(upload.headers.get('Vary')).toBe('Origin');
	});
});

describe('the presigned upload functions', () => {
	type PendingUpload = { uploadToken: string; storageId: Id<'_storage'> };

	const calls: ReadonlyArray<
		readonly [string, (caller: Caller, pending: PendingUpload) => Promise<unknown>]
	> = [
		[
			'aiChat.files.generateUploadUrl',
			(caller) => caller.mutation(api.aiChat.files.generateUploadUrl, {})
		],
		[
			'support.files.generateUploadUrl',
			(caller) =>
				caller.mutation(api.support.files.generateUploadUrl, { anonymousUserId: 'anon_a' })
		],
		['storage.generateUploadUrl', (caller) => caller.mutation(api.storage.generateUploadUrl, {})],
		[
			'aiChat.files.saveUploadedFile',
			(caller, pending) =>
				caller.action(api.aiChat.files.saveUploadedFile, { ...pending, mimeType: 'text/plain' })
		],
		[
			'support.files.saveUploadedFile',
			(caller, pending) =>
				caller.action(api.support.files.saveUploadedFile, { ...pending, mimeType: 'text/plain' })
		],
		[
			'storage.updateProfileImage',
			(caller, pending) => caller.mutation(api.storage.updateProfileImage, pending)
		]
	];

	it.each(calls)('%s refuses a signed-in caller and registers nothing', async (_name, call) => {
		const t = harness();
		const { caller } = await signIn(t);
		const { uploadToken } = await t.mutation(
			components.convexFilesControl.upload.generateUploadUrl,
			{ provider: 'convex' }
		);
		const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(['note'])));
		const before = await stored(t);

		await expect(failure(call(caller, { uploadToken, storageId }))).resolves.toEqual({
			code: 'FILE_STORAGE_UNAVAILABLE'
		});

		expect(await stored(t)).toEqual(before);
		expect((await grants(t)).page).toEqual([]);
	});
});
