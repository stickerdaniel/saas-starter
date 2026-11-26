// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import rateLimiterSchema from '../../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { FILE_ERROR_CODES } from '../../files/errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);

const PREVIEW_BURST = 30;
const DAY = 24 * 60 * 60 * 1000;

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function signIn(t: Harness, email: string) {
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
	return t.withIdentity({ subject: user._id, sessionId: session._id });
}

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('aiChat/files access', () => {
	it('refuses a preview without a session before fetching', async () => {
		const t = harness();
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		await expect(
			refusal(t.action(api.aiChat.files.getAttachmentText, { url: 'https://files.test/a.txt' }))
		).resolves.toBe('Unauthenticated');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('refuses a preview past the preview burst before fetching', async () => {
		const t = harness();
		const caller = await signIn(t, 'reader@example.com');
		for (let i = 0; i < PREVIEW_BURST; i++) {
			await caller.mutation(internal.aiChat.files.checkPreviewAccess, {});
		}
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		await expect(
			refusal(
				caller.action(api.aiChat.files.getAttachmentText, { url: 'https://files.test/a.txt' })
			)
		).resolves.toEqual({
			code: FILE_ERROR_CODES.previewRateLimited,
			retryAfter: expect.any(Number)
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
