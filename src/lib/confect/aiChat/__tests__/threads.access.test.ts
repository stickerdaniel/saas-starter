// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import rateLimiterSchema from '../../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { AI_CHAT_ERROR_CODES } from '../errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);
const agentModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);

const THREAD_CREATES_PER_HOUR = 10;
const DAY = 24 * 60 * 60 * 1000;

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	t.registerComponent('agent', agentSchema, agentModules);
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

const registry = (t: Harness) => t.run(async (ctx) => await ctx.db.query('aiChatThreads').take(50));

describe('aiChat/threads access', () => {
	it('refuses a caller without a session', async () => {
		const t = harness();
		await expect(refusal(t.query(api.aiChat.threads.listThreads, {}))).resolves.toBe(
			'Unauthenticated'
		);
		await expect(
			refusal(t.mutation(api.aiChat.threads.deleteThread, { threadId: 'thread_1' }))
		).resolves.toBe('Unauthenticated');
	});

	it("refuses to delete another user's thread and keeps it", async () => {
		const t = harness();
		const owner = await signIn(t, 'owner@example.com');
		const stranger = await signIn(t, 'stranger@example.com');
		const { threadId } = await owner.caller.mutation(api.aiChat.threads.createThread, {});

		await expect(
			refusal(stranger.caller.mutation(api.aiChat.threads.deleteThread, { threadId }))
		).resolves.toEqual({ code: AI_CHAT_ERROR_CODES.threadNotFound });
		expect(await registry(t)).toHaveLength(1);

		await expect(
			owner.caller.mutation(api.aiChat.threads.deleteThread, { threadId })
		).resolves.toBeNull();
		expect(await registry(t)).toEqual([]);
	});

	it('reuses the warm thread and spends a create token only when it creates one', async () => {
		const t = harness();
		const { caller } = await signIn(t, 'warm@example.com');
		const warm = await caller.mutation(api.aiChat.threads.getOrCreateWarmThread, {});
		for (let i = 1; i < THREAD_CREATES_PER_HOUR; i++) {
			await caller.mutation(api.aiChat.threads.createThread, {});
		}

		await expect(refusal(caller.mutation(api.aiChat.threads.createThread, {}))).resolves.toEqual({
			code: 'RATE_LIMITED',
			retryAfter: expect.any(Number)
		});
		await expect(caller.mutation(api.aiChat.threads.getOrCreateWarmThread, {})).resolves.toEqual(
			warm
		);
		await expect(caller.query(api.aiChat.threads.getWarmThread, {})).resolves.toEqual(warm);
	});

	it('refuses a new warm thread past the create limit with its retry delay', async () => {
		const t = harness();
		const { caller } = await signIn(t, 'limited@example.com');
		for (let i = 0; i < THREAD_CREATES_PER_HOUR; i++) {
			await caller.mutation(api.aiChat.threads.createThread, {});
		}
		const data = await refusal(caller.mutation(api.aiChat.threads.getOrCreateWarmThread, {}));
		expect(data).toMatchObject({ code: 'RATE_LIMITED' });
		expect((data as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
		await expect(caller.query(api.aiChat.threads.getWarmThread, {})).resolves.toBeNull();
	});
});

describe('aiChat/threads sidebar list', () => {
	it("lists only the caller's visible threads, newest first, with a limit", async () => {
		const t = harness();
		const { userId, caller } = await signIn(t, 'list@example.com');
		await t.run(async (ctx) => {
			const rows = [
				{ threadId: 'old', createdAt: 1, lastMessageAt: 10, sidebarActivityAt: 10 },
				{ threadId: 'new', createdAt: 2, lastMessageAt: 30, sidebarActivityAt: 30, title: 'T' },
				{ threadId: 'legacy', createdAt: 3, lastMessage: 'Preview', sidebarActivityAt: 0 },
				{ threadId: 'warm', createdAt: 4, isWarm: true }
			];
			for (const row of rows) await ctx.db.insert('aiChatThreads', { userId, ...row });
			await ctx.db.insert('aiChatThreads', {
				userId: 'someone_else',
				threadId: 'foreign',
				createdAt: 5,
				sidebarActivityAt: 99
			});
		});

		await expect(caller.query(api.aiChat.threads.listThreads, { limit: 2 })).resolves.toEqual({
			threads: [
				{ _id: 'new', title: 'T', lastMessageAt: 30 },
				{ _id: 'old', lastMessageAt: 10 }
			],
			hasMore: true
		});
		await expect(caller.query(api.aiChat.threads.listThreads, {})).resolves.toEqual({
			threads: [
				{ _id: 'new', title: 'T', lastMessageAt: 30 },
				{ _id: 'old', lastMessageAt: 10 },
				{ _id: 'legacy', lastMessage: 'Preview', lastMessageAt: 3 }
			],
			hasMore: false
		});
	});

	it('lists the 20 newest threads without a limit', async () => {
		const t = harness();
		const { userId, caller } = await signIn(t, 'default-limit@example.com');
		await t.run(async (ctx) => {
			for (let at = 21; at >= 1; at--) {
				await ctx.db.insert('aiChatThreads', {
					userId,
					threadId: `thread_${at}`,
					createdAt: at,
					lastMessageAt: at,
					sidebarActivityAt: at
				});
			}
		});

		const { threads, hasMore } = await caller.query(api.aiChat.threads.listThreads, {});
		expect(threads.map((thread) => thread._id)).toEqual(
			Array.from({ length: 20 }, (_, index) => `thread_${21 - index}`)
		);
		expect(hasMore).toBe(true);
	});
});

describe('aiChat/threads internal writes', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('keeps the first stored title', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('aiChatThreads', { userId: 'u1', threadId: 't1', createdAt: 1 });
		});
		await t.mutation(internal.aiChat.threads.setThreadTitleIfEmpty, { threadId: 't1', title: 'A' });
		await t.mutation(internal.aiChat.threads.setThreadTitleIfEmpty, { threadId: 't1', title: 'B' });
		await t.mutation(internal.aiChat.threads.setThreadTitleIfEmpty, {
			threadId: 'gone',
			title: 'C'
		});
		expect((await registry(t)).map((row) => row.title)).toEqual(['A']);
	});

	it('stores the preview and sidebar activity of a finished reply', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('aiChatThreads', { userId: 'u1', threadId: 't1', createdAt: 1 });
		});
		await t.mutation(internal.aiChat.threads.updateThreadMetadata, { threadId: 't1' });
		expect((await registry(t))[0]?.sidebarActivityAt).toBeUndefined();
		await t.mutation(internal.aiChat.threads.updateThreadMetadata, {
			threadId: 't1',
			lastMessage: 'Hi',
			lastMessageAt: 42
		});
		expect((await registry(t))[0]).toMatchObject({
			lastMessage: 'Hi',
			lastMessageAt: 42,
			sidebarActivityAt: 42
		});
	});

	it('deletes warm threads older than seven days and keeps the rest', async () => {
		const t = harness();
		vi.setSystemTime(Date.UTC(2026, 0, 1));
		await t.run(async (ctx) => {
			await ctx.db.insert('aiChatThreads', {
				userId: 'u1',
				threadId: 'stale',
				createdAt: 1,
				isWarm: true
			});
			await ctx.db.insert('aiChatThreads', { userId: 'u2', threadId: 'used', createdAt: 1 });
		});
		vi.setSystemTime(Date.UTC(2026, 0, 6));
		await t.run(async (ctx) => {
			await ctx.db.insert('aiChatThreads', {
				userId: 'u3',
				threadId: 'fresh',
				createdAt: 2,
				isWarm: true
			});
		});
		vi.setSystemTime(Date.UTC(2026, 0, 9));

		await expect(t.mutation(internal.aiChat.threads.deleteStaleWarmThreads, {})).resolves.toEqual({
			deleted: 1
		});
		expect((await registry(t)).map((row) => row.threadId).sort()).toEqual(['fresh', 'used']);
	});
});

describe('aiChat/threads metadata backfill', () => {
	it('fills preview, title and activity only for rows without a preview', async () => {
		const t = harness();
		const long = 'x'.repeat(150);
		await t.run(async (ctx) => {
			for (const [key, lastMessage] of [
				['missing', undefined],
				['filled', 'Kept preview']
			] as const) {
				const { _id: threadId } = await ctx.runMutation(components.agent.threads.createThread, {
					title: `Agent ${key}`
				});
				await ctx.runMutation(components.agent.messages.addMessages, {
					threadId,
					messages: [{ message: { role: 'user', content: long } }]
				});
				await ctx.db.insert('aiChatThreads', {
					userId: 'u1',
					threadId,
					createdAt: 1,
					...(lastMessage ? { lastMessage } : {})
				});
			}
		});

		await expect(t.mutation(internal.aiChat.threads.backfillThreadMetadata, {})).resolves.toEqual({
			updated: 1,
			total: 2
		});
		const rows = await registry(t);
		const filled = rows.find((row) => row.title === 'Agent missing');
		expect(filled?.lastMessage).toBe('x'.repeat(100));
		expect(filled?.sidebarActivityAt).toBe(filled?.lastMessageAt);
		expect(rows.find((row) => row.lastMessage === 'Kept preview')?.title).toBeUndefined();
	});
});
