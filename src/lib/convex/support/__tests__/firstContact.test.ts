import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ThreadLifecycleModule from '../threadLifecycle';

type SavedMessage = { threadId: string; role: string };

const state = vi.hoisted(() => ({
	user: null as null | { _id: string; role?: string; name?: string; email?: string },
	saved: [] as SavedMessage[],
	threads: 0
}));

vi.mock('../../auth', () => ({
	authComponent: {
		getAuthUser: vi.fn(async () => {
			if (!state.user) throw new Error('Unauthenticated');
			return state.user;
		}),
		safeGetAuthUser: vi.fn(async () => state.user ?? undefined)
	}
}));

vi.mock('../agent', () => ({
	supportAgent: {
		createThread: vi.fn(async () => ({ threadId: `thread_${++state.threads}` })),
		getThreadMetadata: vi.fn(async (_ctx: unknown, { threadId }: { threadId: string }) => ({
			_id: threadId,
			_creationTime: 0
		})),
		saveMessage: vi.fn(
			async (
				_ctx: unknown,
				args: { threadId: string; prompt?: string; message?: { role: string } }
			) => {
				state.saved.push({ threadId: args.threadId, role: args.message?.role ?? 'user' });
				return { messageId: `message_${state.saved.length}` };
			}
		),
		updateThreadMetadata: vi.fn(),
		deleteThreadAsync: vi.fn(async (_ctx: unknown, { threadId }: { threadId: string }) => {
			state.saved = state.saved.filter((message) => message.threadId !== threadId);
		})
	}
}));

vi.mock('@convex-dev/agent', () => ({
	getFile: vi.fn(),
	saveMessage: vi.fn(async (_ctx: unknown, _component: unknown, args: { threadId: string }) => {
		state.saved.push({ threadId: args.threadId, role: 'assistant' });
		return { messageId: `message_${state.saved.length}` };
	})
}));

vi.mock('../rateLimit', () => ({
	ANONYMOUS_GLOBAL_RATE_LIMIT_KEY: 'anonymous-global',
	supportRateLimiter: { limit: vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 }) }
}));

// The denormalized preview reads the agent component; it is not under test.
vi.mock('../threadLifecycle', async () => {
	const actual = await vi.importActual<typeof ThreadLifecycleModule>('../threadLifecycle');
	return { ...actual, syncSupportLastMessage: vi.fn() };
});

// With the agent off every thread goes to the team, so each user message also
// writes the canned assistant acknowledgement.
vi.mock('../../../config/support', () => ({ isSupportAiEnabled: () => false }));

import { createThread, getOrCreateWarmThread, updateThreadHandoff } from '../threads';
import { createAssistantMessage, sendMessage } from '../messages';
import { internalSetHandoff } from '../handoff';
import { migrateAnonymousTickets } from '../migration';
import { sendAdminReply } from '../../admin/support/mutations';
import { createJourneyStore } from '../../admin/journey/journeyStore.fixtures';

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };
const asRegistered = (fn: unknown) => fn as Registered;

const START = Date.UTC(2026, 9, 8, 12);
const ANON = 'anon_5d0c6a8e-3c4b-4d5e-8f90-123456789abc';

function setup() {
	const store = createJourneyStore({
		users: ['member', 'admin'],
		functions: {
			'admin/support/notifications:getRecentUserMessages': { _handler: async () => [] }
		}
	});
	const call = (fn: unknown, args: object) => store.mutate(asRegistered(fn), args);
	const thread = (threadId: string) =>
		store.docs('supportThreads').find((row) => row.threadId === threadId);
	return { store, call, thread };
}

function at(ms: number) {
	vi.setSystemTime(START + ms);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	at(0);
	state.user = null;
	state.saved = [];
	state.threads = 0;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('first recorded support contact', () => {
	it('is set by the first ordinary message only', async () => {
		const { store, call, thread } = setup();
		state.user = { _id: 'member', name: 'Member', email: 'member@example.com' };

		const created = (await call(createThread, {})) as { threadId: string };
		const warm = (await call(getOrCreateWarmThread, {})) as { threadId: string };
		expect(thread(created.threadId)?.firstUserMessageAt).toBeUndefined();
		expect(thread(warm.threadId)?.firstUserMessageAt).toBeUndefined();
		expect(store.docs('journeyCaptureStarts')).toEqual([]);

		state.user = { _id: 'admin', role: 'admin', name: 'Ada', email: 'ada@example.com' };
		await call(sendAdminReply, { threadId: created.threadId, prompt: 'Looking into it' });
		await call(createAssistantMessage, { threadId: created.threadId, text: 'Ticket received' });
		expect(thread(created.threadId)?.firstUserMessageAt).toBeUndefined();
		expect(store.docs('journeyCaptureStarts')).toEqual([]);

		at(1_000);
		state.user = { _id: 'member', name: 'Member', email: 'member@example.com' };
		await call(sendMessage, { threadId: created.threadId, prompt: 'It broke' });
		expect(state.saved.filter((m) => m.threadId === created.threadId).map((m) => m.role)).toEqual([
			'assistant',
			'assistant',
			'user',
			'assistant'
		]);

		at(3_000);
		state.user = { _id: 'member', name: 'Member', email: 'member@example.com' };
		await call(sendMessage, { threadId: created.threadId, prompt: 'Still broken' });

		expect(thread(created.threadId)?.firstUserMessageAt).toBe(START + 1_000);
		expect(thread(warm.threadId)?.firstUserMessageAt).toBeUndefined();
		expect(store.docs('journeyCaptureStarts')).toEqual([
			expect.objectContaining({ source: 'support', startedAt: START + 1_000 })
		]);
	});

	it('is not set when the agent hands a thread over on its own', async () => {
		const { call, thread } = setup();
		state.user = { _id: 'member', name: 'Member', email: 'member@example.com' };
		const created = (await call(createThread, {})) as { threadId: string };

		await call(internalSetHandoff, { threadId: created.threadId, acknowledge: true });

		expect(thread(created.threadId)?.firstUserMessageAt).toBeUndefined();
	});

	it('survives an anonymous handoff from a warm thread and the move to an account', async () => {
		const { store, call, thread } = setup();
		const warm = (await call(getOrCreateWarmThread, { anonymousUserId: ANON })) as {
			threadId: string;
		};

		at(1_000);
		await call(updateThreadHandoff, { threadId: warm.threadId, anonymousUserId: ANON });
		const afterFirst = {
			messages: state.saved.map((message) => ({ ...message })),
			jobs: store.jobs(),
			thread: { ...thread(warm.threadId) }
		};
		at(2_000);
		await call(updateThreadHandoff, { threadId: warm.threadId, anonymousUserId: ANON });
		expect(state.saved).toEqual(afterFirst.messages);
		expect(store.jobs().map(({ name, args }) => ({ name, args }))).toEqual(
			afterFirst.jobs.map(({ name, args }) => ({ name, args }))
		);
		expect(thread(warm.threadId)).toEqual(afterFirst.thread);

		state.user = { _id: 'member', name: 'Member', email: 'member@example.com' };
		await call(migrateAnonymousTickets, { anonymousUserId: ANON });

		expect(thread(warm.threadId)).toMatchObject({
			userId: 'member',
			firstUserMessageAt: START + 1_000
		});
		expect(state.saved).toContainEqual({ threadId: warm.threadId, role: 'user' });
	});
});
