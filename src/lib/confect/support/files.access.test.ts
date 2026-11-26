// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import rateLimiterSchema from '../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);

const PREVIEW_BURST = 30;

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
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
				expiresAt: now + 60_000,
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

const rateLimited = { code: 'RATE_LIMITED', retryAfter: expect.any(Number) };

afterEach(() => {
	vi.restoreAllMocks();
});

describe('support file access', () => {
	it('refuses a preview past the shared anonymous bucket before fetching', async () => {
		const t = harness();
		for (let i = 0; i < PREVIEW_BURST; i++) {
			await t.mutation(internal.support.files.checkPreviewAccess, { anonymousUserId: `anon_${i}` });
		}
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		expect(
			await refusal(
				t.action(api.support.files.getAttachmentText, {
					url: 'https://files.test/note.txt',
					anonymousUserId: 'anon_fresh'
				})
			)
		).toEqual(rateLimited);
		expect(fetchSpy).not.toHaveBeenCalled();
		await expect(
			(await signIn(t)).mutation(internal.support.files.checkPreviewAccess, {})
		).resolves.toBeNull();
	});
});
