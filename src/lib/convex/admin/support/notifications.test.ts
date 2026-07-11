import { describe, it, expect, vi } from 'vitest';

import { scheduleAdminNotification } from './notifications';

/**
 * Handler-level unit test (the codebase idiom): the Convex fn exposes its
 * handler under `_handler`, so we call it with a hand-built ctx whose `db` is a
 * tiny in-memory store and whose `scheduler.runAfter` is a spy. No Convex
 * runtime.
 *
 * Guards the bare-handoff fix: a "Talk to a human" with zero prior user
 * messages must still create a pending notification and schedule the send. The
 * former `messageIds.length === 0` early return dropped that notification.
 */

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };

const scheduleAdminNotificationH = scheduleAdminNotification as unknown as Fn<
	{
		threadId: string;
		messageIds: string[];
		isReopen: boolean;
		notificationType: 'newTickets' | 'userReplies';
	},
	null
>;

function createCtx() {
	const rows: Array<Record<string, unknown>> = []; // pendingAdminNotifications
	let nextId = 1;
	const runAfter = vi.fn(async (..._args: unknown[]) => `sched_${nextId++}`);

	const db = {
		query: (_table: string) => ({
			withIndex: (
				_index: string,
				cb: (q: { eq: (f: string, v: unknown) => unknown }) => unknown
			) => {
				const filters: Record<string, unknown> = {};
				cb({
					eq: (f, v) => {
						filters[f] = v;
						return {};
					}
				});
				const match = (r: Record<string, unknown>) =>
					Object.entries(filters).every(([k, v]) => r[k] === v);
				return { first: async () => rows.find(match) ?? null };
			}
		}),
		insert: vi.fn(async (_table: string, doc: Record<string, unknown>) => {
			const _id = `pending_${nextId++}`;
			rows.push({ _id, _creationTime: Date.now(), ...doc });
			return _id;
		}),
		patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
			const row = rows.find((r) => r._id === id);
			if (!row) throw new Error(`patch: unknown id ${id}`);
			Object.assign(row, patch);
		}),
		system: { get: async () => null }
	};

	return { ctx: { db, scheduler: { runAfter } }, rows, runAfter };
}

describe('scheduleAdminNotification', () => {
	it('creates a pending row and schedules the send with no messages (bare handoff)', async () => {
		const { ctx, rows, runAfter } = createCtx();

		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_bare',
			messageIds: [],
			isReopen: false,
			notificationType: 'newTickets'
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			threadId: 'thread_bare',
			messageIds: [],
			isReopen: false,
			notificationType: 'newTickets'
		});

		// The send is scheduled and its id is stored back on the pending row.
		expect(runAfter).toHaveBeenCalledTimes(1);
		expect(rows[0].scheduledFnId).toBeDefined();
		// The scheduled send targets the row we just created.
		expect(runAfter.mock.calls[0][2]).toEqual({ notificationId: rows[0]._id });
	});
});
