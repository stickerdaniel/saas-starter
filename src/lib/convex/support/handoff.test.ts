import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { getFunctionName } from 'convex/server';
import type { MessageDoc } from '@convex-dev/agent/validators';

// internalSetHandoff calls syncSupportLastMessage from ./threads for the
// denormalization sync. Stub it so the test stays a handler-level unit test and
// never pulls the heavy threads module (agent, rate limiter, ownership).
vi.mock('./threads', () => ({ syncSupportLastMessage: vi.fn() }));

// The acknowledgement pulls in the agent and the translation table; both are
// env-dependent, so stub them and keep this a handler-level unit test.
vi.mock('./agent', () => ({ supportAgent: { saveMessage: vi.fn() } }));

vi.mock('../i18n/translations', () => ({
	t: vi.fn(() => 'translated'),
	extractLocaleFromUrl: vi.fn(() => 'en')
}));

import { internalSetHandoff, settleUnansweredTurn } from './handoff';
import { syncSupportLastMessage } from './threads';
import { supportAgent } from './agent';

/**
 * Handler-level unit test (the codebase idiom): the Convex fn exposes its
 * handler under `_handler`, called with a hand-built ctx.
 *
 * Guards the bare-handoff fix on the agent tool path: a request_handoff on a
 * thread with zero prior user messages must still schedule the admin
 * notification. The former `recentMessageIds.length > 0` guard skipped it.
 */

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
const internalSetHandoffH = internalSetHandoff as unknown as Fn<
	{ threadId: string; acknowledge?: boolean },
	null
>;

const syncMock = syncSupportLastMessage as unknown as ReturnType<typeof vi.fn>;
const saveMessageMock = supportAgent.saveMessage as unknown as ReturnType<typeof vi.fn>;

function makeCtx(thread: { _id: string; threadId: string; isHandedOff: boolean }) {
	return {
		db: {
			query: (_table: string) => ({
				withIndex: (
					_index: string,
					cb?: (q: { eq: (f: string, v: unknown) => unknown }) => unknown
				) => {
					cb?.({ eq: () => ({}) });
					return { first: async () => thread };
				}
			}),
			patch: vi.fn()
		},
		runQuery: vi.fn(async () => []),
		scheduler: { runAfter: vi.fn((..._args: unknown[]) => {}) }
	};
}

describe('internalSetHandoff', () => {
	it('flags the thread and schedules a notification with no prior user messages', async () => {
		const runAfter = vi.fn((..._args: unknown[]) => {});
		const patch = vi.fn();
		const thread = { _id: 'st_1', threadId: 'thread_1', isHandedOff: false };

		const ctx = {
			db: {
				query: (_table: string) => ({
					withIndex: (
						_index: string,
						cb: (q: { eq: (f: string, v: unknown) => unknown }) => unknown
					) => {
						cb({ eq: () => ({}) });
						return { first: async () => thread };
					}
				}),
				patch
			},
			// getRecentUserMessages returns no ids for a bare handoff.
			runQuery: vi.fn(async () => []),
			scheduler: { runAfter }
		};

		await internalSetHandoffH._handler(ctx, { threadId: 'thread_1' });

		expect(patch).toHaveBeenCalledWith(
			'supportThreads',
			'st_1',
			expect.objectContaining({ isHandedOff: true, awaitingAdminResponse: true })
		);
		expect(runAfter).toHaveBeenCalledTimes(1);
		expect(runAfter.mock.calls[0][2]).toEqual({
			threadId: 'thread_1',
			messageIds: [],
			isReopen: false,
			notificationType: 'newTickets'
		});
	});

	it('is a no-op when the thread is already handed off', async () => {
		const runAfter = vi.fn((..._args: unknown[]) => {});
		const patch = vi.fn();
		const thread = { _id: 'st_1', threadId: 'thread_1', isHandedOff: true };

		const ctx = {
			db: {
				query: (_table: string) => ({
					withIndex: () => ({ first: async () => thread })
				}),
				patch
			},
			runQuery: vi.fn(async () => []),
			scheduler: { runAfter }
		};

		await internalSetHandoffH._handler(ctx, { threadId: 'thread_1' });

		expect(patch).not.toHaveBeenCalled();
		expect(runAfter).not.toHaveBeenCalled();
	});

	// The agent tool relays the model's own words in the same turn, so a canned
	// sentence on top of it would read as the assistant answering twice.
	it('stays silent for the agent tool', async () => {
		vi.clearAllMocks();

		await internalSetHandoffH._handler(
			makeCtx({ _id: 'st_1', threadId: 'thread_1', isHandedOff: false }),
			{ threadId: 'thread_1' }
		);

		expect(saveMessageMock).not.toHaveBeenCalled();
	});

	it('acknowledges when asked, after the denormalization sync', async () => {
		vi.clearAllMocks();
		const ctx = makeCtx({ _id: 'st_1', threadId: 'thread_1', isHandedOff: false });

		await internalSetHandoffH._handler(ctx, { threadId: 'thread_1', acknowledge: true });

		expect(saveMessageMock).toHaveBeenCalledTimes(1);
		expect(saveMessageMock.mock.calls[0][1].message).toEqual({
			role: 'assistant',
			content: 'translated'
		});
		// Syncing this canned sentence would replace the visitor's own message in
		// the admin list preview and in the search index built from it, so it has
		// to come after the sync and there must be no second sync behind it.
		expect(syncMock.mock.invocationCallOrder[0]).toBeLessThan(
			saveMessageMock.mock.invocationCallOrder[0]
		);
		expect(syncMock).toHaveBeenCalledTimes(1);
		// Acknowledging the visitor is half the job: the reason this path exists is
		// that the thread has nobody answering it until the team is told.
		expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1);
		expect(ctx.scheduler.runAfter.mock.calls[0][2]).toEqual(
			expect.objectContaining({ notificationType: 'newTickets' })
		);
	});
});

/**
 * Settling a support agent turn that ended without a reply. The thread's
 * messages live in the agent component, read here through a fake of its two
 * queries that keeps every saved acknowledgement, so a second settlement sees
 * the first one's.
 */
describe('settleUnansweredTurn', () => {
	const settle = settleUnansweredTurn as unknown as Fn<Record<string, unknown>, null>;
	const TURN = { threadId: 'thread_1', promptMessageId: 'm1' };

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function message(
		id: string,
		creationTime: number,
		role: 'user' | 'assistant',
		text?: string
	): MessageDoc {
		return {
			_id: id,
			_creationTime: creationTime,
			threadId: 'thread_1',
			order: creationTime,
			stepOrder: 0,
			status: 'success',
			tool: false,
			message: { role, content: text ?? [] },
			...(text !== undefined ? { text } : {})
		};
	}

	function settleCtx(options: { handedOff: boolean | null; rows?: MessageDoc[] }) {
		const rows = options.rows ?? [message('m1', 10, 'user', 'help')];
		saveMessageMock.mockImplementation(async () => {
			rows.push(message(`ack_${rows.length}`, 100 + rows.length, 'assistant', 'translated'));
			return { messageId: `ack_${rows.length}` };
		});
		const thread =
			options.handedOff === null
				? null
				: { _id: 'st_1', threadId: 'thread_1', pageUrl: '', isHandedOff: options.handedOff };
		return {
			db: {
				query: () => ({ withIndex: () => ({ first: async () => thread }) }),
				patch: vi.fn(async () => {
					if (thread) thread.isHandedOff = true;
				})
			},
			runQuery: vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
				if ('messageIds' in args) {
					return (args.messageIds as string[]).map(
						(id) => rows.find((row) => row._id === id) ?? null
					);
				}
				if ('order' in args) {
					// Like the component: a full page is never done, even when it is the last.
					const { numItems, cursor } = args.paginationOpts as {
						numItems: number;
						cursor: string | null;
					};
					const start = Number(cursor ?? 0);
					const page = [...rows].sort((a, b) => b.order - a.order).slice(start, start + numItems);
					return {
						page,
						isDone: page.length < numItems,
						continueCursor: String(start + page.length)
					};
				}
				// getRecentUserMessages
				return [];
			}),
			scheduler: { runAfter: vi.fn((..._args: unknown[]) => {}) }
		};
	}

	function scheduled(ctx: ReturnType<typeof settleCtx>) {
		return ctx.scheduler.runAfter.mock.calls.map(([, reference]) =>
			getFunctionName(reference as never)
		);
	}

	it('hands a thread still with the agent to the team and logs it once', async () => {
		const ctx = settleCtx({ handedOff: false });

		await settle._handler(ctx, {
			...TURN,
			reason: 'no_reply',
			attempts: 2,
			visibleText: false,
			errorName: 'APICallError',
			status: 502
		});

		expect(ctx.db.patch).toHaveBeenCalledWith(
			'supportThreads',
			'st_1',
			expect.objectContaining({ isHandedOff: true, awaitingAdminResponse: true })
		);
		expect(saveMessageMock).toHaveBeenCalledOnce();
		expect(scheduled(ctx)).toEqual(['admin/support/notifications:scheduleAdminNotification']);
		expect(vi.mocked(console.error).mock.calls).toEqual([
			[
				{
					code: 'support_turn_unanswered',
					threadId: 'thread_1',
					promptMessageId: 'm1',
					reason: 'no_reply',
					attempts: 2,
					visibleText: false,
					errorName: 'APICallError',
					status: 502
				}
			]
		]);
	});

	// The agent's request_handoff told the team, then the model never spoke.
	it('only acknowledges a handed-off thread whose visitor heard nothing', async () => {
		const ctx = settleCtx({ handedOff: true });

		await settle._handler(ctx, { ...TURN, reason: 'handoff_without_reply', attempts: 1 });

		expect(ctx.db.patch).not.toHaveBeenCalled();
		expect(saveMessageMock).toHaveBeenCalledOnce();
		expect(saveMessageMock.mock.calls[0][1].message).toEqual({
			role: 'assistant',
			content: 'translated'
		});
		// No second new-ticket announcement: the handoff already made it.
		expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
		expect(vi.mocked(console.warn).mock.calls).toEqual([
			[
				{
					code: 'support_turn_handoff_without_reply',
					threadId: 'thread_1',
					promptMessageId: 'm1',
					reason: 'handoff_without_reply',
					attempts: 1
				}
			]
		]);
	});

	// The action and the watchdog can both settle one turn, in either order.
	it('acknowledges a turn once however often it is settled', async () => {
		const ctx = settleCtx({ handedOff: true });

		await settle._handler(ctx, { ...TURN, reason: 'handoff_without_reply' });
		await settle._handler(ctx, { ...TURN, reason: 'job_failed' });

		expect(saveMessageMock).toHaveBeenCalledOnce();
		expect(console.warn).toHaveBeenCalledOnce();
	});

	// The widget's handoff button writes the acknowledgement before it flips the
	// thread, and a team reply answers the visitor as well.
	it.each([
		{ label: 'the handoff button', reply: message('ack_button', 20, 'assistant', 'translated') },
		{
			label: 'the team',
			reply: { ...message('team_reply', 20, 'assistant', 'On it'), provider: 'human' }
		},
		{
			label: 'the agent on the same turn',
			reply: { ...message('agent_reply', 20, 'assistant', 'Here you go'), order: 10 }
		}
	])('adds nothing once $label answered the visitor', async ({ reply }) => {
		const ctx = settleCtx({
			handedOff: true,
			rows: [message('m1', 10, 'user', 'help'), reply]
		});

		await settle._handler(ctx, { ...TURN, reason: 'handoff_without_reply' });

		expect(saveMessageMock).not.toHaveBeenCalled();
		expect(console.warn).not.toHaveBeenCalled();
	});

	// A second tab's message gets its own agent answer on a later order. It
	// answers that message, not this one, whose handoff the visitor was never
	// told about.
	it('still acknowledges when only the agent answered a later message', async () => {
		const ctx = settleCtx({
			handedOff: true,
			rows: [
				message('m1', 10, 'user', 'help'),
				message('m2', 15, 'user', 'and pricing?'),
				{ ...message('agent_m2', 20, 'assistant', 'It costs 29 euros'), order: 15 }
			]
		});

		await settle._handler(ctx, { ...TURN, reason: 'handoff_without_reply' });

		expect(saveMessageMock).toHaveBeenCalledOnce();
	});

	// A team reply from before the prompt answered an earlier message, not this one.
	it('still acknowledges when the only reply predates the prompt', async () => {
		const ctx = settleCtx({
			handedOff: true,
			rows: [
				{ ...message('earlier', 5, 'assistant', 'Hi there'), provider: 'human' },
				message('m1', 10, 'user', 'help')
			]
		});

		await settle._handler(ctx, { ...TURN, reason: 'handoff_without_reply' });

		expect(saveMessageMock).toHaveBeenCalledOnce();
	});

	// The visitor kept writing to the handed-off thread before the turn settled,
	// so the prompt sits beyond the first page of the lookback.
	const laterVisitorRows = Array.from({ length: 30 }, (_, index) =>
		message(`later_${index}`, 30 + index, 'user', 'still there?')
	);

	it('adds nothing when the acknowledgement lies past the first page', async () => {
		const ctx = settleCtx({
			handedOff: true,
			rows: [
				message('m1', 10, 'user', 'help'),
				message('ack_button', 20, 'assistant', 'translated'),
				...laterVisitorRows
			]
		});

		await settle._handler(ctx, { ...TURN, reason: 'job_failed' });

		expect(saveMessageMock).not.toHaveBeenCalled();
	});

	// The agent's request_handoff flips the thread without telling the visitor.
	it('acknowledges a silent handoff whose prompt lies past the first page', async () => {
		const ctx = settleCtx({
			handedOff: true,
			rows: [message('m1', 10, 'user', 'help'), ...laterVisitorRows]
		});

		await settle._handler(ctx, { ...TURN, reason: 'job_failed' });

		expect(saveMessageMock).toHaveBeenCalledOnce();
	});

	it('logs a status that is not an integer without it', async () => {
		const ctx = settleCtx({ handedOff: false });

		await settle._handler(ctx, { ...TURN, reason: 'no_reply', status: 502.5 });

		expect(vi.mocked(console.error).mock.calls[0]?.[0]).not.toHaveProperty('status');
	});

	it('does nothing for a thread that no longer exists', async () => {
		const ctx = settleCtx({ handedOff: null });

		await settle._handler(ctx, { ...TURN, reason: 'job_missing' });

		expect(saveMessageMock).not.toHaveBeenCalled();
		expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
		expect(console.error).not.toHaveBeenCalled();
	});
});
