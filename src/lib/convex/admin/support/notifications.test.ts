import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

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
import { shouldSkipTestEmail } from '../../emails/helpers';
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
		patch: vi.fn(async (_table: string, id: string, patch: Record<string, unknown>) => {
			const row = rows.find((r) => r._id === id);
			if (!row) throw new Error(`patch: unknown id ${id}`);
			Object.assign(row, patch);
		}),
		get: vi.fn(async (_table: string, id: string) => rows.find((r) => r._id === id) ?? null),
		delete: vi.fn(async (_table: string, id: string) => {
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
				retryCount: 0,
				claimToken: 'token_1'
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
				notificationId: 'notification_1',
				claimToken: 'token_1'
			});
			expect(runQuery).not.toHaveBeenCalled();
		}
	);
});

/**
 * A send owns a pending row while `scheduledFnId` is cleared and the row holds
 * the claim token `claimNotificationForSending` issued to it. A customer message
 * arriving during the action's multi-second send window re-arms the row with a
 * fresh scheduled function, taking ownership back, and that newer send may claim
 * the row before the first one finishes. The tests below force exactly those
 * interleavings, because an in-flight action that still writes to a row it no
 * longer owns deletes the follow-up digest and the customer's message is never
 * emailed.
 */
type ClaimArgs = { notificationId: string; issueToken?: boolean };
type DeleteArgs = { notificationId: string; claimToken?: string };
type RescheduleArgs = { notificationId: string; claimToken?: string; delayMs?: number };

const claimNotificationForSendingH = claimNotificationForSending as unknown as Fn<
	ClaimArgs,
	{ claimToken: string } | null
>;
const deletePendingNotificationH = deletePendingNotification as unknown as Fn<DeleteArgs, boolean>;
const reschedulePendingNotificationH = reschedulePendingNotification as unknown as Fn<
	RescheduleArgs,
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
	options: {
		onFirstSend?: () => Promise<void>;
		sendThrows?: boolean;
		targetEmails?: string[];
	} = {}
) {
	let pendingHook = options.onFirstSend;
	const sentEmails: Array<Record<string, unknown>> = [];
	const sendAttempts: string[] = [];
	const messageIdsSeen: string[][] = [];

	const runMutation = vi.fn(async (reference: unknown, args: Record<string, unknown>) => {
		const name = getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
		switch (name) {
			case 'admin/support/notifications:claimNotificationForSending':
				return claimNotificationForSendingH._handler(ctx, args as ClaimArgs);
			case 'admin/support/notifications:deletePendingNotification':
				return deletePendingNotificationH._handler(ctx, args as DeleteArgs);
			case 'admin/support/notifications:reschedulePendingNotification':
				return reschedulePendingNotificationH._handler(ctx, args as RescheduleArgs);
			case 'emails/send:sendNewTicketAdminNotification': {
				const email = args.email as string;
				sendAttempts.push(email);
				// Mirrors the sender's own guard: nothing is enqueued for a test address.
				if (shouldSkipTestEmail('sendNewTicketAdminNotification', email)) return false;
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
				return options.targetEmails ?? ['admin@example.com'];
			case 'admin/support/notifications:getMessageContents':
				messageIdsSeen.push(args.messageIds as string[]);
				return [];
			default:
				throw new Error(`unexpected query ${name}`);
		}
	});

	return { runMutation, runQuery, sentEmails, sendAttempts, messageIdsSeen };
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

	it('keeps a newer claim when an older send finishes during it', async () => {
		const { ctx, rows, runAfter } = createCtx();

		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_overlap',
			messageIds: ['message_1'],
			isReopen: false,
			notificationType: 'newTickets'
		});
		const notificationId = rows[0]._id as string;

		// B's only send waits until A has finished, then fails.
		let releaseB!: () => void;
		const aFinished = new Promise<void>((resolve) => (releaseB = resolve));
		let markBSending!: () => void;
		const bSending = new Promise<void>((resolve) => (markBSending = resolve));
		const sendB = createActionCtx(ctx, {
			sendThrows: true,
			onFirstSend: async () => {
				markBSending();
				await aFinished;
			}
		});

		let runB: Promise<null> | undefined;
		const sendA = createActionCtx(ctx, {
			// While A emails message 1, the customer replies and the re-armed send B
			// claims the row before A finishes.
			onFirstSend: async () => {
				await scheduleAdminNotificationH._handler(ctx, {
					threadId: 'thread_overlap',
					messageIds: ['message_2'],
					isReopen: false,
					notificationType: 'userReplies'
				});
				runB = sendPendingAdminNotificationH._handler(sendB, { notificationId });
				await bSending;
			}
		});

		await sendPendingAdminNotificationH._handler(sendA, { notificationId });
		expect(sendA.messageIdsSeen).toEqual([['message_1']]);
		expect(rows).toHaveLength(1);

		releaseB();
		await runB;

		// B's failure schedules its retry on the row A left alone.
		expect(sendB.messageIdsSeen).toEqual([['message_1', 'message_2']]);
		expect(rows).toHaveLength(1);
		expect(rows[0].retryCount).toBe(1);
		expect(runAfter).toHaveBeenCalledTimes(3);
		expect(runAfter.mock.calls[2][0]).toBe(60_000);
		expect(rows[0].scheduledFnId).toBeDefined();

		// The retry delivers both messages and clears the row.
		const retry = createActionCtx(ctx);
		await sendPendingAdminNotificationH._handler(retry, { notificationId });

		expect(retry.sentEmails).toHaveLength(1);
		expect(retry.messageIdsSeen).toEqual([['message_1', 'message_2']]);
		expect(rows).toHaveLength(0);
	});

	it('refuses cleanup with an older or missing claim token', async () => {
		const { ctx, rows } = createCtx();

		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_tokens',
			messageIds: ['message_1'],
			isReopen: false,
			notificationType: 'newTickets'
		});
		const notificationId = rows[0]._id as string;

		const older = await claimNotificationForSendingH._handler(ctx, {
			notificationId,
			issueToken: true
		});
		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_tokens',
			messageIds: ['message_2'],
			isReopen: false,
			notificationType: 'userReplies'
		});
		const newer = await claimNotificationForSendingH._handler(ctx, {
			notificationId,
			issueToken: true
		});
		expect(older).not.toBeNull();
		expect(newer).not.toBeNull();

		for (const claimToken of [older!.claimToken, undefined]) {
			expect(await deletePendingNotificationH._handler(ctx, { notificationId, claimToken })).toBe(
				false
			);
			expect(
				await reschedulePendingNotificationH._handler(ctx, { notificationId, claimToken })
			).toBe(false);
		}
		expect(rows).toHaveLength(1);
		expect(rows[0].scheduledFnId).toBeUndefined();
		expect(rows[0].retryCount).toBeUndefined();

		expect(
			await deletePendingNotificationH._handler(ctx, {
				notificationId,
				claimToken: newer!.claimToken
			})
		).toBe(true);
		expect(rows).toHaveLength(0);
	});

	it('hands a row claimed without a token to a new send', async () => {
		const { ctx, rows, runAfter } = createCtx();

		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_legacy',
			messageIds: ['message_1'],
			isReopen: false,
			notificationType: 'newTickets'
		});
		const notificationId = rows[0]._id as string;
		const armedFnId = rows[0].scheduledFnId;

		// An action started before the token protocol claims without asking for one.
		expect(await claimNotificationForSendingH._handler(ctx, { notificationId })).toBeNull();

		expect(runAfter).toHaveBeenCalledTimes(2);
		expect(runAfter.mock.calls[1][0]).toBe(0);
		expect(runAfter.mock.calls[1][2]).toEqual({ notificationId });
		expect(rows[0].scheduledFnId).toBeDefined();
		expect(rows[0].scheduledFnId).not.toBe(armedFnId);

		// The new send claims with a token and delivers.
		const handoff = createActionCtx(ctx);
		await sendPendingAdminNotificationH._handler(handoff, { notificationId });
		expect(handoff.sentEmails).toHaveLength(1);
		expect(rows).toHaveLength(0);
	});

	it('lets a send that claimed before tokens existed clean up its own row', async () => {
		const { ctx, rows } = createCtx();

		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_legacy_cleanup',
			messageIds: ['message_1'],
			isReopen: false,
			notificationType: 'newTickets'
		});
		const notificationId = rows[0]._id as string;
		// A claim made by the previous deployment cleared scheduledFnId and wrote no token.
		rows[0].scheduledFnId = undefined;

		expect(await deletePendingNotificationH._handler(ctx, { notificationId })).toBe(true);
		expect(rows).toHaveLength(0);
	});
});

/**
 * E2E test addresses can be notification recipients. They are never sent to,
 * so they must not count as a delivery that discards a real recipient's retry,
 * and a notification with only test recipients must finish instead of retrying.
 */
describe('test recipients in pending notifications', () => {
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

	async function schedulePending(ctx: unknown, rows: Array<Record<string, unknown>>) {
		await scheduleAdminNotificationH._handler(ctx, {
			threadId: 'thread_test_recipients',
			messageIds: ['message_1'],
			isReopen: false,
			notificationType: 'newTickets'
		});
		return rows[0]._id as string;
	}

	it('retries a failed real recipient alongside a test recipient', async () => {
		const { ctx, rows, runAfter } = createCtx();
		const notificationId = await schedulePending(ctx, rows);

		const send = createActionCtx(ctx, {
			sendThrows: true,
			targetEmails: ['admin@e2e.example.com', 'admin@example.com']
		});
		await sendPendingAdminNotificationH._handler(send, { notificationId });

		expect(rows).toHaveLength(1);
		expect(rows[0].retryCount).toBe(1);
		expect(runAfter).toHaveBeenCalledTimes(2);
		expect(runAfter.mock.calls[1][0]).toBe(60_000);
		expect(send.sendAttempts).toEqual(['admin@example.com']);
	});

	it('completes without sends or retries when every recipient is a test address', async () => {
		const { ctx, rows, runAfter } = createCtx();
		const notificationId = await schedulePending(ctx, rows);

		const send = createActionCtx(ctx, {
			targetEmails: ['admin@e2e.example.com', 'support@e2e.example.com']
		});
		await sendPendingAdminNotificationH._handler(send, { notificationId });

		expect(rows).toHaveLength(0);
		expect(runAfter).toHaveBeenCalledTimes(1);
		expect(send.sendAttempts).toEqual([]);
	});
});

/**
 * Every customer message restarts the debounce, so without a cap a customer who
 * writes more often than the delay holds the alert back forever. These tests run
 * messages and scheduled sends on one simulated clock. The scheduler mirrors
 * Convex: a job runs at its due time, a cancelled job never runs, and `runAfter`
 * rejects a negative delay.
 */
describe('debounce cap', () => {
	const MINUTE = 60_000;
	const START = Date.UTC(2026, 0, 1);

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
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(START);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	type CustomerWrites = (messageId: string) => Promise<void>;

	function createClockedCtx(
		options: { duringFirstSend?: (customerWrites: CustomerWrites) => Promise<void> } = {}
	) {
		const { ctx: base } = createCtx();
		const jobs = new Map<string, { dueAt: number; notificationId: string }>();
		let nextJob = 1;
		const ctx = {
			db: {
				...base.db,
				system: {
					get: async (id: string) => (jobs.has(id) ? { state: { kind: 'pending' } } : null)
				}
			},
			scheduler: {
				runAfter: async (
					delayMs: number,
					_reference: unknown,
					args: { notificationId: string }
				) => {
					if (delayMs < 0) throw new Error('`delayMs` must be non-negative');
					const id = `job_${nextJob++}`;
					jobs.set(id, { dueAt: Date.now() + delayMs, notificationId: args.notificationId });
					return id;
				},
				cancel: async (id: string) => {
					jobs.delete(id);
				}
			}
		};

		const customerWrites: CustomerWrites = async (messageId) => {
			await scheduleAdminNotificationH._handler(ctx, {
				threadId: 'thread_chatty',
				messageIds: [messageId],
				isReopen: false,
				notificationType: 'userReplies'
			});
		};

		// A write that fails inside the send would look like a failed email, so
		// surface it as the failure it is.
		let hookError: unknown;
		const duringFirstSend = options.duringFirstSend;
		// Read on every send, so a test can make the provider fail for a while.
		const sendOptions = {
			sendThrows: false,
			onFirstSend:
				duringFirstSend &&
				(async () => {
					try {
						await duringFirstSend(customerWrites);
					} catch (error) {
						hookError = error;
					}
				})
		};
		const send = createActionCtx(ctx, sendOptions);
		const failSends = (fail: boolean) => {
			sendOptions.sendThrows = fail;
		};

		const deliveries: Array<{ at: number; messageIds: string[] }> = [];

		/** Run every job due by `offset` after START, in due order, then move the clock there. */
		async function advanceTo(offset: number) {
			for (;;) {
				const [next] = [...jobs.entries()].sort(([, a], [, b]) => a.dueAt - b.dueAt);
				if (!next || next[1].dueAt > START + offset) break;
				const [id, job] = next;
				jobs.delete(id);
				vi.setSystemTime(job.dueAt);
				const sentBefore = send.sentEmails.length;
				await sendPendingAdminNotificationH._handler(send, {
					notificationId: job.notificationId
				});
				if (hookError) throw hookError;
				if (send.sentEmails.length > sentBefore) {
					deliveries.push({
						at: job.dueAt - START,
						messageIds: send.messageIdsSeen[send.messageIdsSeen.length - 1]
					});
				}
			}
			vi.setSystemTime(START + offset);
		}

		return { customerWrites, advanceTo, failSends, deliveries };
	}

	it('alerts within 15 minutes when the customer writes every 3 minutes', async () => {
		const clock = createClockedCtx();

		for (let minute = 0; minute < 30; minute += 3) {
			await clock.advanceTo(minute * MINUTE);
			await clock.customerWrites(`message_${minute}`);
		}
		await clock.advanceTo(30 * MINUTE);

		// The first row sends at its cap with everything written so far; the message
		// at minute 15 starts a new row, which sends at its own cap.
		expect(clock.deliveries).toEqual([
			{
				at: 15 * MINUTE,
				messageIds: ['message_0', 'message_3', 'message_6', 'message_9', 'message_12']
			},
			{
				at: 30 * MINUTE,
				messageIds: ['message_15', 'message_18', 'message_21', 'message_24', 'message_27']
			}
		]);
	});

	const CAPPED = ['message_0', 'message_3', 'message_6', 'message_9', 'message_12'];

	it('waits a full delay after a capped send before sending a reply written during it', async () => {
		const clock = createClockedCtx({
			// The customer writes again while the capped send is still emailing, when
			// the row is already past its cap.
			duringFirstSend: async (customerWrites) => {
				vi.setSystemTime(START + 15 * MINUTE + 5_000);
				await customerWrites('message_late');
			}
		});

		for (let minute = 0; minute < 15; minute += 3) {
			await clock.advanceTo(minute * MINUTE);
			await clock.customerWrites(`message_${minute}`);
		}
		await clock.advanceTo(25 * MINUTE);

		// The follow-up still carries the ids the running send had already passed on.
		expect(clock.deliveries).toEqual([
			{ at: 15 * MINUTE, messageIds: CAPPED },
			{ at: 19 * MINUTE + 5_000, messageIds: [...CAPPED, 'message_late'] }
		]);
	});

	it('keeps the retry backoff when the customer writes during it', async () => {
		const clock = createClockedCtx();

		for (let minute = 0; minute < 15; minute += 3) {
			await clock.advanceTo(minute * MINUTE);
			await clock.customerWrites(`message_${minute}`);
		}
		// The capped send fails, so the row waits a minute before its retry.
		clock.failSends(true);
		await clock.advanceTo(15 * MINUTE);
		clock.failSends(false);

		await clock.advanceTo(15 * MINUTE + 30_000);
		await clock.customerWrites('message_during_retry');
		await clock.advanceTo(20 * MINUTE);

		expect(clock.deliveries).toEqual([
			{ at: 16 * MINUTE, messageIds: [...CAPPED, 'message_during_retry'] }
		]);
	});

	it('sends right away when a message finds an overdue send still queued', async () => {
		const clock = createClockedCtx();

		for (let minute = 0; minute < 15; minute += 3) {
			await clock.advanceTo(minute * MINUTE);
			await clock.customerWrites(`message_${minute}`);
		}
		// The scheduler is behind: the capped send is due but has not run yet.
		vi.setSystemTime(START + 15 * MINUTE + 30_000);
		await clock.customerWrites('message_overdue');
		await clock.advanceTo(20 * MINUTE);

		expect(clock.deliveries).toEqual([
			{ at: 15 * MINUTE + 30_000, messageIds: [...CAPPED, 'message_overdue'] }
		]);
	});
});
