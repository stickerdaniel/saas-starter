// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import rateLimiterSchema from '../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import filesControl from '@gilhrpenner/convex-files-control/test';
import { mutationGeneric, type GenericMutationCtx, type GenericDataModel } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { PROFILE_IMAGE_ALLOWED_TYPES, PROFILE_IMAGE_MAX_SIZE } from '../constants';
import { convexModules, preloadModules } from '../convexTest.modules';

type StoredMetadata = { size: number; contentType: string | null };

const storedMetadata = new Map<string, StoredMetadata>();

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
				const stored = storedMetadata.get(args.storageId);
				return await upload.finalizeUpload._handler(ctx, {
					...args,
					metadata: stored && { ...stored, sha256: 'sha256' }
				});
			}
		})
	};
};

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);

const DAY = 24 * 60 * 60 * 1000;
const SITE_URL = 'https://site.test';
const UPLOADS_PER_HOUR = 10;

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
	filesControl.register(t);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function signIn(t: Harness) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Ada',
				email: 'ada@example.com',
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
	return t.withIdentity({ subject: user._id, sessionId: session._id });
}

async function failure(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const grants = (t: Harness) =>
	t.query(components.convexFilesControl.queries.listDownloadGrantsPage, {
		paginationOpts: { numItems: 10, cursor: null }
	});

const files = (t: Harness) =>
	t.query(components.convexFilesControl.queries.listFilesPage, {
		paginationOpts: { numItems: 10, cursor: null }
	});

async function uploadWithMetadata(t: Harness, metadata: StoredMetadata | null) {
	const caller = await signIn(t);
	const { uploadToken } = await caller.mutation(api.storage.generateUploadUrl, {});
	const storageId = crypto.randomUUID();
	if (metadata) storedMetadata.set(storageId, metadata);
	return caller.mutation(api.storage.updateProfileImage, { storageId, uploadToken });
}

beforeEach(() => {
	vi.stubEnv('SITE_URL', 'https://example.test');
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret');
	vi.stubEnv('CONVEX_SITE_URL', SITE_URL);
});

afterEach(() => {
	vi.unstubAllEnvs();
	storedMetadata.clear();
});

describe('storage access', () => {
	it('refuses both functions without a session and writes nothing', async () => {
		const t = harness();

		await expect(failure(t.mutation(api.storage.generateUploadUrl, {}))).resolves.toBe(
			'Unauthenticated'
		);
		await expect(
			failure(t.mutation(api.storage.updateProfileImage, { storageId: 's', uploadToken: 'u' }))
		).resolves.toBe('Unauthenticated');

		expect((await files(t)).page).toEqual([]);
		expect((await grants(t)).page).toEqual([]);
	});
});

describe('generateUploadUrl', () => {
	it('limits upload URLs per user with the rate limit code', async () => {
		const t = harness();
		const caller = await signIn(t);
		for (let i = 0; i < UPLOADS_PER_HOUR; i++) {
			await expect(caller.mutation(api.storage.generateUploadUrl, {})).resolves.toMatchObject({
				storageProvider: 'convex',
				uploadToken: expect.any(String)
			});
		}

		const data = await failure(caller.mutation(api.storage.generateUploadUrl, {}));

		expect(data).toEqual({ code: 'RATE_LIMITED', retryAfter: expect.any(Number) });
		expect((data as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
	});
});

describe('updateProfileImage', () => {
	it.each([
		['an SVG', { contentType: 'image/svg+xml', size: 100 }],
		['an empty type', { contentType: '', size: 100 }],
		['a missing type', { contentType: null, size: 100 }]
	])('refuses %s without issuing a public grant', async (_label, metadata) => {
		const t = harness();

		await expect(failure(uploadWithMetadata(t, metadata))).resolves.toEqual({
			code: 'FILE_TYPE_NOT_ALLOWED',
			allowedTypes: PROFILE_IMAGE_ALLOWED_TYPES
		});

		expect((await files(t)).page).toEqual([]);
		expect((await grants(t)).page).toEqual([]);
	});

	it('refuses an oversized image without issuing a public grant', async () => {
		const t = harness();

		await expect(
			failure(uploadWithMetadata(t, { contentType: 'image/png', size: PROFILE_IMAGE_MAX_SIZE + 1 }))
		).resolves.toEqual({
			code: 'FILE_TOO_LARGE',
			maxBytes: PROFILE_IMAGE_MAX_SIZE,
			actualBytes: PROFILE_IMAGE_MAX_SIZE + 1
		});

		expect((await grants(t)).page).toEqual([]);
	});

	it.each(PROFILE_IMAGE_ALLOWED_TYPES)('returns an inline avatar URL for %s', async (type) => {
		const t = harness();

		const url = await uploadWithMetadata(t, { contentType: type, size: 100 });

		const [grant] = (await grants(t)).page;
		expect(url).toBe(`${SITE_URL}/files/inline?token=${grant?._id}`);
		expect(grant).toMatchObject({ maxUses: null, expiresAt: null });
		expect((await files(t)).page).toHaveLength(1);
	});

	it('refuses without a site URL and issues no grant', async () => {
		const t = harness();
		vi.stubEnv('CONVEX_SITE_URL', '');

		await expect(
			failure(uploadWithMetadata(t, { contentType: 'image/png', size: 100 }))
		).resolves.toEqual({ code: 'FILE_STORAGE_UNAVAILABLE' });

		expect((await grants(t)).page).toEqual([]);
	});
});
