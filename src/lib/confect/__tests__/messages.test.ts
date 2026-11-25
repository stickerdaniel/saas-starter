// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import rateLimiterSchema from '../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { checkAndCountUsage } from '../autumn';
import { MAX_MESSAGE_LENGTH } from '../constants';
import { convexModules, preloadModules } from '../convexTest.modules';
import { appRateLimiter } from '../rateLimit';

vi.mock('../autumn', () => ({ checkAndCountUsage: vi.fn() }));

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);

const DAY = 24 * 60 * 60 * 1000;
const SENDS_PER_MINUTE = 5;

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function signIn(t: Harness, name: string) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name,
				email: `${name.replaceAll(' ', '.')}@example.com`,
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
		caller: t.withIdentity({ subject: user._id, sessionId: session._id }),
		userId: user._id
	};
}

async function failure(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const messages = (t: Harness) => t.run(async (ctx) => await ctx.db.query('messages').take(1000));

const scheduled = (t: Harness) =>
	t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').take(1000));

const communityCapture = (t: Harness) =>
	t.run(
		async (ctx) =>
			await ctx.db
				.query('journeyCaptureStarts')
				.withIndex('by_source', (q) => q.eq('source', 'community'))
				.take(10)
	);

const insertMessage = (t: Harness, userId: string, body: string) =>
	t.run(async (ctx) => await ctx.db.insert('messages', { userId, body }));

const enforce = (t: Harness, userId: string, messageId: Id<'messages'>, outcome: string) => {
	vi.mocked(checkAndCountUsage).mockResolvedValue(outcome as never);
	return t.action(internal.messages.enforceAndTrackMessageUsage, { userId, messageId });
};

const settle = (t: Harness, messageId: Id<'messages'>) =>
	t.mutation(internal.messages.markMessageSettled, { messageId });

beforeEach(() => {
	vi.stubEnv('SITE_URL', 'https://example.test');
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret');
	vi.stubEnv('CAPABILITY_PROFILE', 'production');
	vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_messages');
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe('messages access', () => {
	it('refuses list and send without a session and writes nothing', async () => {
		const t = harness();

		await expect(failure(t.query(api.messages.list, {}))).resolves.toBe('Unauthenticated');
		await expect(failure(t.mutation(api.messages.send, { body: 'hello' }))).resolves.toBe(
			'Unauthenticated'
		);

		expect(await messages(t)).toEqual([]);
		expect(await scheduled(t)).toEqual([]);
	});
});

describe('enforceAndTrackMessageUsage', () => {
	it('keeps a counted message and marks it settled', async () => {
		const t = harness();
		const { userId } = await signIn(t, 'Name of owner');
		const messageId = await insertMessage(t, userId, 'hello');

		await enforce(t, userId, messageId, 'counted');

		expect(checkAndCountUsage).toHaveBeenCalledWith({ customerId: userId, featureId: 'messages' });
		expect(await messages(t)).toEqual([
			expect.objectContaining({ body: 'hello', quotaSettledAt: expect.any(Number) })
		]);
	});

	it('removes the message only on a definitive denial', async () => {
		const t = harness();
		const { userId } = await signIn(t, 'Name of owner');
		const messageId = await insertMessage(t, userId, 'hello');

		await enforce(t, userId, messageId, 'denied');

		expect(await messages(t)).toEqual([]);
	});

	it('keeps the message uncounted when Autumn is unavailable', async () => {
		const t = harness();
		const { userId } = await signIn(t, 'Name of owner');
		const messageId = await insertMessage(t, userId, 'hello');

		await expect(enforce(t, userId, messageId, 'unavailable')).resolves.toBeNull();

		expect(await messages(t)).toEqual([expect.objectContaining({ body: 'hello' })]);
	});
});

describe('removeMessage', () => {
	it('deletes an existing message', async () => {
		const t = harness();
		const messageId = await insertMessage(t, 'user_1', 'hello');

		await t.mutation(internal.messages.removeMessage, { messageId });

		expect(await messages(t)).toEqual([]);
	});

	it('is a no-op when the message is already gone', async () => {
		const t = harness();
		const messageId = await insertMessage(t, 'user_1', 'hello');
		await t.mutation(internal.messages.removeMessage, { messageId });

		await expect(t.mutation(internal.messages.removeMessage, { messageId })).resolves.toBeNull();
	});
});

describe('send', () => {
	it('does not save or schedule a message without ready billing configuration', async () => {
		const t = harness();
		const { caller } = await signIn(t, 'Ada');
		vi.stubEnv('AUTUMN_SECRET_KEY', '');

		await expect(caller.mutation(api.messages.send, { body: 'hello' })).rejects.toThrow(
			'[capability] billing is'
		);

		expect(await messages(t)).toEqual([]);
		expect(await scheduled(t)).toEqual([]);
	});

	it('refuses an overlong message with its code and limit and writes nothing', async () => {
		const t = harness();
		const { caller } = await signIn(t, 'Ada');

		await expect(
			failure(caller.mutation(api.messages.send, { body: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }))
		).resolves.toEqual({ code: 'COMMUNITY_MESSAGE_TOO_LONG', maxLength: MAX_MESSAGE_LENGTH });

		expect(await messages(t)).toEqual([]);
		expect(await scheduled(t)).toEqual([]);
		await expect(
			caller.mutation(api.messages.send, { body: 'x'.repeat(MAX_MESSAGE_LENGTH) })
		).resolves.toEqual({ messageId: expect.any(String) });
	});

	it('rejects with a structured error when the rate limit is exhausted', async () => {
		const t = harness();
		const { caller } = await signIn(t, 'Ada');
		for (let i = 0; i < SENDS_PER_MINUTE; i++) {
			await caller.mutation(api.messages.send, { body: `hello ${i}` });
		}

		const data = await failure(caller.mutation(api.messages.send, { body: 'one more' }));

		expect(data).toEqual({ code: 'RATE_LIMITED', retryAfter: expect.any(Number) });
		expect((data as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
		expect(await messages(t)).toHaveLength(SENDS_PER_MINUTE);
		expect(await scheduled(t)).toHaveLength(SENDS_PER_MINUTE);
	});

	it('forwards the limiter delay unchanged and writes nothing', async () => {
		const t = harness();
		const { caller } = await signIn(t, 'Ada');
		vi.spyOn(appRateLimiter, 'limit').mockResolvedValueOnce({ ok: false, retryAfter: 12000 });

		await expect(failure(caller.mutation(api.messages.send, { body: 'hello' }))).resolves.toEqual({
			code: 'RATE_LIMITED',
			retryAfter: 12000
		});
		expect(await messages(t)).toEqual([]);
		expect(await scheduled(t)).toEqual([]);
	});

	it('inserts the message and schedules the quota backstop with its id', async () => {
		const t = harness();
		const { caller, userId } = await signIn(t, 'Ada');

		const result = await caller.mutation(api.messages.send, { body: 'hello' });

		expect(await messages(t)).toEqual([
			expect.objectContaining({ _id: result.messageId, userId, body: 'hello' })
		]);
		expect(await scheduled(t)).toEqual([
			expect.objectContaining({
				name: 'messages:enforceAndTrackMessageUsage',
				args: [{ userId, messageId: result.messageId }]
			})
		]);
	});
});

describe('community message settlement', () => {
	const START = Date.UTC(2026, 9, 8, 12);

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(START);
	});

	it.each(['counted', 'unavailable'])('keeps and settles a %s message', async (outcome) => {
		const t = harness();
		const { userId } = await signIn(t, 'owner');
		const messageId = await insertMessage(t, userId, 'hello');

		await enforce(t, userId, messageId, outcome);

		const [message] = await messages(t);
		expect(message).toEqual(expect.objectContaining({ body: 'hello' }));
		expect(message?.quotaSettledAt).toBeGreaterThanOrEqual(START);
		expect(message?.quotaSettledAt).toBeLessThan(START + 1000);
		expect(await communityCapture(t)).toEqual([
			expect.objectContaining({ startedAt: message?.quotaSettledAt })
		]);
	});

	it('deletes a denied message and records nothing', async () => {
		const t = harness();
		const { userId } = await signIn(t, 'owner');
		const messageId = await insertMessage(t, userId, 'hello');

		await enforce(t, userId, messageId, 'denied');

		expect(await messages(t)).toEqual([]);
		expect(await communityCapture(t)).toEqual([]);
	});

	it('leaves a settled message as it was when settled again', async () => {
		const t = harness();
		const { userId } = await signIn(t, 'owner');
		const messageId = await insertMessage(t, userId, 'hello');

		await settle(t, messageId);
		const settledAt = (await messages(t))[0]?.quotaSettledAt;
		vi.setSystemTime(START + 60_000);
		await settle(t, messageId);

		expect(settledAt).toBeGreaterThanOrEqual(START);
		expect((await messages(t))[0]?.quotaSettledAt).toBe(settledAt);
	});

	it('does nothing for a message that is already gone', async () => {
		const t = harness();
		const { userId } = await signIn(t, 'owner');
		const messageId = await insertMessage(t, userId, 'hello');
		await t.mutation(internal.messages.removeMessage, { messageId });

		await expect(settle(t, messageId)).resolves.toBeNull();

		expect(await communityCapture(t)).toEqual([]);
	});

	it('writes nothing once the owner has been deleted', async () => {
		const t = harness();
		const { userId } = await signIn(t, 'owner');
		const messageId = await insertMessage(t, userId, 'hello');
		await t.mutation(components.betterAuth.adapter.deleteOne, {
			input: { model: 'user', where: [{ field: '_id', operator: 'eq', value: userId }] }
		});

		await settle(t, messageId);

		expect((await messages(t))[0]?.quotaSettledAt).toBeUndefined();
		expect(await communityCapture(t)).toEqual([]);
	});
});

describe('messages.list', () => {
	it('returns the public shape for unsettled and settled messages', async () => {
		const t = harness();
		const { caller, userId } = await signIn(t, 'Name of owner');
		const messageId = await insertMessage(t, userId, 'hello');
		await insertMessage(t, userId, 'later, never settled');
		await settle(t, messageId);
		const { userId: goneId } = await signIn(t, 'Gone');
		await insertMessage(t, goneId, 'from a deleted account');
		await t.mutation(components.betterAuth.adapter.deleteOne, {
			input: { model: 'user', where: [{ field: '_id', operator: 'eq', value: goneId }] }
		});

		const result = await caller.query(api.messages.list, {});

		expect(result).toEqual([
			{
				_id: messageId,
				_creationTime: expect.any(Number),
				userId,
				body: 'hello',
				author: 'Name of owner'
			},
			expect.objectContaining({ body: 'later, never settled', author: 'Name of owner' }),
			expect.objectContaining({ body: 'from a deleted account', author: 'Anonymous' })
		]);
		expect(result[0]).not.toHaveProperty('quotaSettledAt');
	});
});
