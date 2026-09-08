import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../emails/resend', () => ({
	getEmailDeliveryConfiguration: vi.fn(() => ({
		state: 'ready',
		value: {
			apiKey: 'configured',
			sender: 'sender@example.com',
			assetUrl: 'https://assets.example.com'
		}
	}))
}));

import { getEmailDeliveryConfiguration } from '../../emails/resend';
import { scheduleAdminNotification, sendPendingAdminNotification } from './notifications';

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
const sendPendingAdminNotificationH = sendPendingAdminNotification as unknown as Fn<
	{ notificationId: string },
	null
>;
const getEmailConfigurationMock = getEmailDeliveryConfiguration as unknown as ReturnType<
	typeof vi.fn
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
	beforeEach(() => {
		vi.clearAllMocks();
		getEmailConfigurationMock.mockReturnValue({
			state: 'ready',
			value: {
				apiKey: 'configured',
				sender: 'sender@example.com',
				assetUrl: 'https://assets.example.com'
			}
		});
	});

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
		expect(runAfter.mock.calls[0][0]).toBe(4 * 60 * 1000);
		expect(rows[0].scheduledFnId).toBeDefined();
		// The scheduled send targets the row we just created.
		expect(runAfter.mock.calls[0][2]).toEqual({ notificationId: rows[0]._id });
	});

	it.each(['disabled', 'misconfigured'] as const)(
		'does not create pending work when email is %s',
		async (state) => {
			getEmailConfigurationMock.mockReturnValue(
				state === 'disabled' ? { state } : { state, issue: 'missing' }
			);
			const { ctx, rows, runAfter } = createCtx();

			await scheduleAdminNotificationH._handler(ctx, {
				threadId: 'thread_1',
				messageIds: ['message_1'],
				isReopen: false,
				notificationType: 'newTickets'
			});

			expect(rows).toHaveLength(0);
			expect(runAfter).not.toHaveBeenCalled();
		}
	);
});

describe('sendPendingAdminNotification', () => {
	it.each(['disabled', 'misconfigured'] as const)(
		'deletes a claimed row without queries, sends, or retries when email is %s',
		async (state) => {
			getEmailConfigurationMock.mockReturnValue(
				state === 'disabled' ? { state } : { state, issue: 'missing' }
			);
			const notification = {
				threadId: 'thread_1',
				messageIds: ['message_1'],
				isReopen: false,
				notificationType: 'newTickets',
				retryCount: 0
			};
			const runMutation = vi.fn().mockResolvedValueOnce(notification).mockResolvedValueOnce(true);
			const runQuery = vi.fn();

			expect(
				await sendPendingAdminNotificationH._handler(
					{ runMutation, runQuery },
					{ notificationId: 'notification_1' }
				)
			).toBeNull();
			expect(runMutation).toHaveBeenCalledTimes(2);
			expect(runMutation.mock.calls[1][1]).toEqual({
				notificationId: 'notification_1'
			});
			expect(runQuery).not.toHaveBeenCalled();
		}
	);
});
