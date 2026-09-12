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
import { getFunctionName } from 'convex/server';
import {
	claimNotificationForSending,
	deletePendingNotification,
	reschedulePendingNotification,
	scheduleAdminNotification,
	sendPendingAdminNotification
} from './notifications';

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
		get: vi.fn(async (id: string) => rows.find((r) => r._id === id) ?? null),
		delete: vi.fn(async (id: string) => {
			const index = rows.findIndex((r) => r._id === id);
			if (index !== -1) rows.splice(index, 1);
		}),
		system: { get: async () => null }
	};

	const cancel = vi.fn(async (_id: string) => {});

	return { ctx: { db, scheduler: { runAfter, cancel } }, rows, runAfter, cancel };
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

/**
 * Ownership of a pending row is signalled by `scheduledFnId === undefined`:
 * `claimNotificationForSending` clears it, and a customer message arriving
 * during the action's multi-second send window re-arms the row with a fresh
 * scheduled function, taking ownership back. The tests below force exactly that
 * interleaving, because an in-flight action that still writes to a re-armed row
 * deletes the follow-up digest and the customer's message is never emailed.
 */
const claimNotificationForSendingH = claimNotificationForSending as unknown as Fn<
	{ notificationId: string },
	unknown
>;
const deletePendingNotificationH = deletePendingNotification as unknown as Fn<
	{ notificationId: string },
	boolean
>;
const reschedulePendingNotificationH = reschedulePendingNotification as unknown as Fn<
	{ notificationId: string; delayMs?: number },
	boolean
>;

/**
 * Drive the action against the real claim/delete/reschedule handlers over one
 * shared store, so ownership transitions are exercised rather than stubbed.
 * `onFirstSend` runs inside the first email send, which is the window the
 * production action spends off-transaction.
 */
function createActionCtx(
	ctx: unknown,
	options: { onFirstSend?: () => Promise<void>; sendThrows?: boolean } = {}
) {
	let pendingHook = options.onFirstSend;
	const sentEmails: Array<Record<string, unknown>> = [];
	const messageIdsSeen: string[][] = [];

	const runMutation = vi.fn(async (reference: unknown, args: Record<string, unknown>) => {
		const name = getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
		switch (name) {
			case 'admin/support/notifications:claimNotificationForSending':
				return claimNotificationForSendingH._handler(ctx, args as { notificationId: string });
			case 'admin/support/notifications:deletePendingNotification':
				return deletePendingNotificationH._handler(ctx, args as { notificationId: string });
			case 'admin/support/notifications:reschedulePendingNotification':
				return reschedulePendingNotificationH._handler(
					ctx,
					args as { notificationId: string; delayMs?: number }
				);
			case 'emails/send:sendNewTicketAdminNotification': {
				if (pendingHook) {
					const hook = pendingHook;
					pendingHook = undefined;
					await hook();
				}
				if (options.sendThrows) throw new Error('provider unreachable');
				sentEmails.push(args);
				return true;
			}
			default:
				throw new Error(`unexpected mutation ${name}`);
		}
	});

	const runQuery = vi.fn(async (reference: unknown, args: Record<string, unknown>) => {
		const name = getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
		switch (name) {
			case 'admin/support/notifications:getSupportThread':
				return { threadId: args.threadId, userName: 'Visitor', assignedTo: undefined };
			case 'admin/support/notifications:getNotificationTargetEmails':
				return ['admin@example.com'];
			case 'admin/support/notifications:getMessageContents':
				messageIdsSeen.push(args.messageIds as string[]);
				return [];
			default:
				throw new Error(`unexpected query ${name}`);
		}
	});

	return { runMutation, runQuery, sentEmails, messageIdsSeen };
}

describe('pending notification ownership', () => {
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

	it('delivers a message that arrives while the send is in flight', async () => {
		const { ctx, rows, runAfter } = createCtx();

		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_race',
			messageIds: ['message_1'],
			isReopen: false,
			notificationType: 'newTickets'
		});
		expect(rows).toHaveLength(1);
		const armedFnId = rows[0].scheduledFnId;
		expect(armedFnId).toBeDefined();

		const notificationId = rows[0]._id as string;
		let reArmedFnId: unknown;
		const firstSend = createActionCtx(ctx, {
			// The customer replies while the first digest is still being emailed.
			onFirstSend: async () => {
				await scheduleAdminNotificationH._handler(ctx, {
					threadId: 'thread_race',
					messageIds: ['message_2'],
					isReopen: false,
					notificationType: 'userReplies'
				});
				reArmedFnId = rows[0].scheduledFnId;
			}
		});

		await sendPendingAdminNotificationH._handler(firstSend, { notificationId });

		// The re-arm owns the row now, so the finished send must leave it alone.
		expect(rows).toHaveLength(1);
		expect(rows[0].messageIds).toEqual(['message_1', 'message_2']);
		expect(rows[0].scheduledFnId).toBe(reArmedFnId);
		expect(reArmedFnId).not.toBe(armedFnId);
		expect(runAfter).toHaveBeenCalledTimes(2);

		// The re-armed send then delivers both messages and clears the row.
		const secondSend = createActionCtx(ctx);
		await sendPendingAdminNotificationH._handler(secondSend, { notificationId });

		expect(secondSend.sentEmails).toHaveLength(1);
		expect(secondSend.messageIdsSeen).toEqual([['message_1', 'message_2']]);
		expect(rows).toHaveLength(0);
	});

	it('does not reschedule a row that was re-armed during failed sends', async () => {
		const { ctx, rows, runAfter } = createCtx();

		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_retry',
			messageIds: ['message_1'],
			isReopen: false,
			notificationType: 'newTickets'
		});
		const notificationId = rows[0]._id as string;

		let reArmedFnId: unknown;
		const failingSend = createActionCtx(ctx, {
			sendThrows: true,
			onFirstSend: async () => {
				await scheduleAdminNotificationH._handler(ctx, {
					threadId: 'thread_retry',
					messageIds: ['message_2'],
					isReopen: false,
					notificationType: 'userReplies'
				});
				reArmedFnId = rows[0].scheduledFnId;
			}
		});

		await sendPendingAdminNotificationH._handler(failingSend, { notificationId });

		// The retry belongs to the re-armed send, not to the evicted one.
		expect(rows).toHaveLength(1);
		expect(rows[0].scheduledFnId).toBe(reArmedFnId);
		expect(rows[0].retryCount).toBeUndefined();
		expect(runAfter).toHaveBeenCalledTimes(2);
	});

	it('reschedules an owned row after failed sends', async () => {
		const { ctx, rows, runAfter } = createCtx();

		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_retry',
			messageIds: ['message_1'],
			isReopen: false,
			notificationType: 'newTickets'
		});
		const notificationId = rows[0]._id as string;
		const armedFnId = rows[0].scheduledFnId;

		const failingSend = createActionCtx(ctx, { sendThrows: true });
		await sendPendingAdminNotificationH._handler(failingSend, { notificationId });

		expect(rows).toHaveLength(1);
		expect(rows[0].retryCount).toBe(1);
		expect(rows[0].scheduledFnId).toBeDefined();
		expect(rows[0].scheduledFnId).not.toBe(armedFnId);
		expect(runAfter).toHaveBeenCalledTimes(2);
		expect(runAfter.mock.calls[1][0]).toBe(60_000);
	});
});
