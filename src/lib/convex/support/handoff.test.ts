import { describe, it, expect, vi } from 'vitest';

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

import { internalSetHandoff } from './handoff';
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

		await internalSetHandoffH._handler(
			makeCtx({ _id: 'st_1', threadId: 'thread_1', isHandedOff: false }),
			{ threadId: 'thread_1', acknowledge: true }
		);

		expect(saveMessageMock).toHaveBeenCalledTimes(1);
		expect(saveMessageMock.mock.calls[0][1].message).toEqual({
			role: 'assistant',
			content: 'translated'
		});
		// Syncing this canned sentence would replace the visitor's own message in
		// the admin list preview and in the search index built from it.
		expect(syncMock.mock.invocationCallOrder[0]).toBeLessThan(
			saveMessageMock.mock.invocationCallOrder[0]
		);
	});
});
