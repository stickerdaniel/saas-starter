// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import schema from '../../convex/schema';
import authSchema from '../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../convexTest.modules';
import { SUPPORT_ERROR_CODES, createSupportError } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
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
	return {
		userId: user._id,
		caller: t.withIdentity({ subject: user._id, sessionId: session._id })
	};
}

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const seedThread = (t: Harness, fields: Partial<Doc<'supportThreads'>> = {}) =>
	t.run((ctx) =>
		ctx.db.insert('supportThreads', {
			threadId: 'thread_1',
			userId: 'anon_owner',
			status: 'open',
			createdAt: 1,
			updatedAt: 2,
			lastAdminReplyAt: 50,
			lastAdminReplyMessageId: 'message_a',
			hasUnreadAdminReply: true,
			unreadAdminReplyCount: 2,
			...fields
		})
	);

const threads = (t: Harness) => t.run((ctx) => ctx.db.query('supportThreads').take(100));

const { readState } = api.support;

const markRead = (anonymousUserId: string | undefined, readThroughMessageId = 'message_a') => ({
	threadId: 'thread_1',
	anonymousUserId,
	readThroughMessageId
});

describe('support read state access', () => {
	it('refuses an unknown thread before checking the owner', async () => {
		const t = harness();
		await seedThread(t, { threadId: 'thread_other' });
		const before = await threads(t);

		expect(await refusal(t.mutation(readState.markThreadRead, markRead(undefined)))).toEqual(
			createSupportError(SUPPORT_ERROR_CODES.threadNotFound).data
		);
		expect(await refusal(t.mutation(readState.markThreadRead, markRead('anon_owner')))).toEqual(
			createSupportError(SUPPORT_ERROR_CODES.threadNotFound).data
		);
		expect(await threads(t)).toEqual(before);
	});

	it('refuses a caller without owner on an existing thread without writing', async () => {
		const t = harness();
		await seedThread(t);
		const before = await threads(t);

		for (const anonymousUserId of [undefined, 'visitor_1']) {
			expect(
				await refusal(t.mutation(readState.markThreadRead, markRead(anonymousUserId)))
			).toEqual(createSupportError(SUPPORT_ERROR_CODES.authenticationRequired).data);
		}
		expect(await threads(t)).toEqual(before);
	});

	it('refuses another owner without writing', async () => {
		const t = harness();
		await seedThread(t);
		const { caller } = await signIn(t);
		const before = await threads(t);

		expect(await refusal(t.mutation(readState.markThreadRead, markRead('anon_other')))).toEqual(
			createSupportError(SUPPORT_ERROR_CODES.threadForbidden).data
		);
		expect(
			await refusal(caller.mutation(readState.markThreadRead, markRead('anon_owner')))
		).toEqual(createSupportError(SUPPORT_ERROR_CODES.threadForbidden).data);
		expect(await threads(t)).toEqual(before);
	});

	it('records the read timestamp without reordering the thread', async () => {
		const t = harness();
		await seedThread(t);
		const start = Date.now();

		await expect(t.mutation(readState.markThreadRead, markRead('anon_owner'))).resolves.toBeNull();

		const [thread] = await threads(t);
		expect(thread).toMatchObject({
			hasUnreadAdminReply: false,
			unreadAdminReplyCount: 0,
			updatedAt: 2
		});
		expect(thread?.userReadAt).toBeGreaterThanOrEqual(start);
		expect(thread?.userReadAt).toBeLessThanOrEqual(Date.now());
	});

	it('marks a signed-in owner thread read', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t);
		await seedThread(t, { userId });

		await expect(
			caller.mutation(readState.markThreadRead, markRead(undefined))
		).resolves.toBeNull();

		expect(await threads(t)).toMatchObject([{ hasUnreadAdminReply: false }]);
	});

	it('keeps a same-millisecond newer reply unread when its message ID differs', async () => {
		const t = harness();
		await seedThread(t, { lastAdminReplyAt: 100, lastAdminReplyMessageId: 'message_b' });
		const before = await threads(t);

		await expect(
			t.mutation(readState.markThreadRead, markRead('anon_owner', 'message_a'))
		).resolves.toBeNull();
		expect(await threads(t)).toEqual(before);
	});

	it('does not rewrite a receipt that already covers the latest reply', async () => {
		const t = harness();
		await seedThread(t, {
			lastAdminReplyAt: 100,
			userReadAt: 101,
			hasUnreadAdminReply: false,
			unreadAdminReplyCount: undefined
		});
		const before = await threads(t);

		await expect(t.mutation(readState.markThreadRead, markRead('anon_owner'))).resolves.toBeNull();
		expect(await threads(t)).toEqual(before);
	});

	it('reads nothing for a caller without owner', async () => {
		const t = harness();
		await seedThread(t);

		for (const args of [{}, { anonymousUserId: undefined }, { anonymousUserId: 'visitor_1' }]) {
			await expect(t.query(readState.hasUnreadAdminReply, args)).resolves.toBe(false);
			await expect(t.query(readState.unreadAdminReplyCount, args)).resolves.toBe(0);
		}
	});

	it('reads the unread state of the anonymous or signed-in owner', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t);
		await seedThread(t);
		await seedThread(t, { threadId: 'thread_2', userId, unreadAdminReplyCount: 14 });

		await expect(
			t.query(readState.hasUnreadAdminReply, { anonymousUserId: 'anon_owner' })
		).resolves.toBe(true);
		await expect(
			t.query(readState.unreadAdminReplyCount, { anonymousUserId: 'anon_owner' })
		).resolves.toBe(2);
		await expect(caller.query(readState.hasUnreadAdminReply, {})).resolves.toBe(true);
		await expect(
			caller.query(readState.unreadAdminReplyCount, { anonymousUserId: 'anon_owner' })
		).resolves.toBe(10);
		await expect(
			t.query(readState.unreadAdminReplyCount, { anonymousUserId: 'anon_other' })
		).resolves.toBe(0);
	});
});
