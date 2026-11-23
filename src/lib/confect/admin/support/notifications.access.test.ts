// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import schema from '../../../convex/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';

vi.mock('../../emails/resend', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getEmailDeliveryConfiguration: () => ({
		state: 'ready',
		value: { apiKey: 'configured', sender: 'sender@example.com', assetUrl: 'https://a.example' }
	})
}));

const agentModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);

const START = Date.UTC(2030, 0, 1);
const MINUTE = 60 * 1000;
const NOTIFICATION_DELAY_MS = 4 * MINUTE;
const CLAIM_LEASE_MS = 31 * MINUTE;
const notifications = internal.admin.support.notifications;
const SEND = 'admin/support/notifications:sendPendingAdminNotification';
const RECOVER = 'admin/support/notifications:recoverNotificationClaim';
const CLEANUP = 'admin/support/notificationDelivery:cleanupReceipts';

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('agent', agentSchema, agentModules);
	return t;
};
type Harness = ReturnType<typeof harness>;
type NotificationId = Id<'pendingAdminNotifications'>;

const at = (ms: number) => vi.setSystemTime(ms);

const jobs = (t: Harness) =>
	t.run(async (ctx) =>
		(await ctx.db.system.query('_scheduled_functions').take(100)).map((job) => ({
			name: job.name,
			args: job.args,
			time: job.scheduledTime,
			state: job.state.kind
		}))
	);

const send = (notificationId: NotificationId, time: number, state = 'pending') => ({
	name: SEND,
	args: [{ notificationId }],
	time,
	state
});

const seedThread = (t: Harness) =>
	t.run(async (ctx) => {
		const { _id: threadId } = await ctx.runMutation(components.agent.threads.createThread, {});
		const { messages } = await ctx.runMutation(components.agent.messages.addMessages, {
			threadId,
			messages: [
				{ message: { role: 'user', content: 'Refund please' } },
				{ message: { role: 'assistant', content: 'One moment' } },
				{ message: { role: 'user', content: 'Talk to support' } }
			]
		});
		await ctx.db.insert('supportThreads', {
			threadId,
			userId: 'anon_visitor',
			status: 'open',
			userName: 'Visitor',
			createdAt: 1,
			updatedAt: 2
		});
		await ctx.db.insert('adminNotificationPreferences', {
			email: 'admin@example.com',
			isAdminUser: true,
			notifyNewSupportTickets: true,
			notifyUserReplies: false,
			notifyNewSignups: false,
			createdAt: 1,
			updatedAt: 1
		});
		return { threadId, messageIds: messages.map((message) => message._id) };
	});

const schedule = (t: Harness, threadId: string, messageIds: string[] = []) =>
	t.mutation(notifications.scheduleAdminNotification, {
		threadId,
		messageIds,
		isReopen: false,
		notificationType: 'newTickets'
	});

const pendingRow = (t: Harness) =>
	t.run(async (ctx) => {
		const row = await ctx.db.query('pendingAdminNotifications').first();
		if (!row) throw new Error('no pending notification');
		return row;
	});

const claim = async (t: Harness, notificationId: NotificationId) => {
	const result = await t.mutation(notifications.claimNotificationForSending, {
		notificationId,
		issueToken: true,
		receiptProtocol: 1
	});
	if (!result) throw new Error('no claim');
	return result;
};

const recovery = (
	notificationId: NotificationId,
	{ generation, claimToken }: { generation: string; claimToken: string },
	deadline: number,
	state = 'pending'
) => ({
	name: RECOVER,
	args: [{ notificationId, generation, claimToken, deadline }],
	time: deadline,
	state
});

const scheduledThread = async (t: Harness) => {
	const thread = await seedThread(t);
	at(START);
	await schedule(t, thread.threadId);
	const { _id: notificationId } = await pendingRow(t);
	return { ...thread, notificationId };
};

describe('admin support notifications without identity', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		at(START - 60 * MINUTE);
	});
	afterEach(() => vi.useRealTimers());

	it('schedules a send, re-arms it and re-arms a claimed row', async () => {
		const t = harness();
		const { threadId, messageIds } = await seedThread(t);

		at(START);
		await expect(schedule(t, threadId)).resolves.toBeNull();
		const { _id: notificationId } = await pendingRow(t);
		expect(await jobs(t)).toEqual([send(notificationId, START + NOTIFICATION_DELAY_MS)]);

		const rearmAt = START + MINUTE;
		at(rearmAt);
		await expect(schedule(t, threadId, [messageIds[0]])).resolves.toBeNull();
		expect(await jobs(t)).toEqual([
			send(notificationId, START + NOTIFICATION_DELAY_MS, 'canceled'),
			send(notificationId, rearmAt + NOTIFICATION_DELAY_MS)
		]);

		const claimAt = rearmAt + 10_000;
		at(claimAt);
		const claimed = await claim(t, notificationId);
		expect(claimed).toMatchObject({
			threadId,
			messageIds: [messageIds[0]],
			isReopen: false,
			notificationType: 'newTickets',
			retryCount: 0,
			hadEnqueue: false
		});
		const deadline = claimAt + CLAIM_LEASE_MS;
		expect(await jobs(t)).toEqual([
			send(notificationId, START + NOTIFICATION_DELAY_MS, 'canceled'),
			send(notificationId, rearmAt + NOTIFICATION_DELAY_MS),
			recovery(notificationId, claimed, deadline)
		]);

		const reclaimAt = claimAt + 5_000;
		at(reclaimAt);
		await schedule(t, threadId, [messageIds[2]]);
		expect(await jobs(t)).toEqual([
			send(notificationId, START + NOTIFICATION_DELAY_MS, 'canceled'),
			send(notificationId, rearmAt + NOTIFICATION_DELAY_MS),
			recovery(notificationId, claimed, deadline, 'canceled'),
			send(notificationId, reclaimAt + NOTIFICATION_DELAY_MS)
		]);
		const rearmed = await pendingRow(t);
		expect(rearmed.messageIds).toEqual([messageIds[0], messageIds[2]]);
		expect(rearmed).not.toHaveProperty('claimToken');
		expect(rearmed).not.toHaveProperty('recoveryFnId');
	});

	it('retries a failed send and recovers an expired lease', async () => {
		const t = harness();
		const { notificationId } = await scheduledThread(t);
		const first = send(notificationId, START + NOTIFICATION_DELAY_MS);

		const claimAt = START + NOTIFICATION_DELAY_MS;
		at(claimAt);
		const firstClaim = await claim(t, notificationId);
		const firstDeadline = claimAt + CLAIM_LEASE_MS;

		at(claimAt + MINUTE);
		const early = {
			notificationId,
			generation: firstClaim.generation,
			claimToken: firstClaim.claimToken,
			deadline: firstDeadline
		};
		await expect(t.mutation(notifications.recoverNotificationClaim, early)).resolves.toBe(false);
		expect(await jobs(t)).toEqual([first, recovery(notificationId, firstClaim, firstDeadline)]);

		const retryAt = claimAt + 2 * MINUTE;
		at(retryAt);
		await expect(
			t.mutation(notifications.reschedulePendingNotification, {
				notificationId,
				claimToken: firstClaim.claimToken,
				delayMs: 90_000
			})
		).resolves.toBe(true);
		expect(await jobs(t)).toEqual([
			first,
			recovery(notificationId, firstClaim, firstDeadline, 'canceled'),
			send(notificationId, retryAt + 90_000)
		]);

		const secondClaimAt = retryAt + 90_000;
		at(secondClaimAt);
		const secondClaim = await claim(t, notificationId);
		const secondDeadline = secondClaimAt + CLAIM_LEASE_MS;

		at(secondDeadline);
		await expect(
			t.mutation(notifications.recoverNotificationClaim, {
				notificationId,
				generation: secondClaim.generation,
				claimToken: secondClaim.claimToken,
				deadline: secondDeadline
			})
		).resolves.toBe(true);
		expect(await jobs(t)).toEqual([
			first,
			recovery(notificationId, firstClaim, firstDeadline, 'canceled'),
			send(notificationId, retryAt + 90_000),
			recovery(notificationId, secondClaim, secondDeadline, 'canceled'),
			send(notificationId, secondDeadline + 60_000)
		]);
		const retried = await pendingRow(t);
		expect(retried.retryCount).toBe(2);
		expect(retried).not.toHaveProperty('claimToken');
	});

	it('retries with the default delay up to the fifth retry', async () => {
		const t = harness();
		const { notificationId } = await scheduledThread(t);
		await t.run((ctx) =>
			ctx.db.patch('pendingAdminNotifications', notificationId, { retryCount: 4 })
		);
		const claimAt = START + NOTIFICATION_DELAY_MS;
		at(claimAt);
		const claimed = await claim(t, notificationId);
		const retryAt = claimAt + MINUTE;
		at(retryAt);

		await expect(
			t.mutation(notifications.reschedulePendingNotification, {
				notificationId,
				claimToken: claimed.claimToken
			})
		).resolves.toBe(true);

		expect(await jobs(t)).toEqual([
			send(notificationId, START + NOTIFICATION_DELAY_MS),
			recovery(notificationId, claimed, claimAt + CLAIM_LEASE_MS, 'canceled'),
			send(notificationId, retryAt + 60_000)
		]);
		expect((await pendingRow(t)).retryCount).toBe(5);
	});

	it('stops an abandoned claim at the retry limit', async () => {
		const t = harness();
		const { notificationId } = await scheduledThread(t);
		await t.run((ctx) =>
			ctx.db.patch('pendingAdminNotifications', notificationId, { retryCount: 5 })
		);
		const claimAt = START + NOTIFICATION_DELAY_MS;
		at(claimAt);
		const claimed = await claim(t, notificationId);
		const deadline = claimAt + CLAIM_LEASE_MS;

		await expect(
			t.mutation(notifications.reschedulePendingNotification, {
				notificationId,
				claimToken: claimed.claimToken
			})
		).resolves.toBe(false);
		at(deadline);
		await expect(
			t.mutation(notifications.recoverNotificationClaim, {
				notificationId,
				generation: claimed.generation,
				claimToken: claimed.claimToken,
				deadline
			})
		).resolves.toBe(true);

		expect(await jobs(t)).toEqual([
			send(notificationId, START + NOTIFICATION_DELAY_MS),
			recovery(notificationId, claimed, deadline, 'canceled')
		]);
		expect(await t.run((ctx) => ctx.db.query('pendingAdminNotifications').take(1))).toEqual([]);
	});

	it('hands a claim without the receipt protocol to a fresh send', async () => {
		const t = harness();
		const { notificationId } = await scheduledThread(t);
		const handoffAt = START + MINUTE;
		at(handoffAt);

		await expect(
			t.mutation(notifications.claimNotificationForSending, { notificationId })
		).resolves.toBeNull();
		at(handoffAt + MINUTE);
		await expect(
			t.mutation(notifications.claimNotificationForSending, { notificationId, issueToken: true })
		).resolves.toBeNull();

		const scheduled = await jobs(t);
		expect(scheduled).toEqual([
			send(notificationId, START + NOTIFICATION_DELAY_MS),
			send(notificationId, handoffAt),
			send(notificationId, handoffAt + MINUTE)
		]);
		const lastJob = await t.run(
			async (ctx) => (await ctx.db.system.query('_scheduled_functions').order('desc').first())?._id
		);
		expect((await pendingRow(t)).scheduledFnId).toBe(lastJob);

		await claim(t, notificationId);
		await expect(
			t.mutation(notifications.claimNotificationForSending, {
				notificationId,
				issueToken: true,
				receiptProtocol: 1
			})
		).resolves.toBeNull();
		expect(await jobs(t)).toHaveLength(4);
	});

	it('deletes an owned row, cancels its recovery and cleans up its receipts', async () => {
		const t = harness();
		const { notificationId } = await scheduledThread(t);
		const claimAt = START + NOTIFICATION_DELAY_MS;
		at(claimAt);
		const claimed = await claim(t, notificationId);
		await t.run((ctx) =>
			ctx.db.insert('supportNotificationReceipts', {
				notificationId,
				generation: claimed.generation,
				email: 'admin@example.com'
			})
		);

		await expect(
			t.mutation(notifications.deletePendingNotification, { notificationId })
		).resolves.toBe(false);
		const deleteAt = claimAt + MINUTE;
		at(deleteAt);
		await expect(
			t.mutation(notifications.deletePendingNotification, {
				notificationId,
				claimToken: claimed.claimToken
			})
		).resolves.toBe(true);

		expect(await jobs(t)).toEqual([
			send(notificationId, START + NOTIFICATION_DELAY_MS),
			recovery(notificationId, claimed, claimAt + CLAIM_LEASE_MS, 'canceled'),
			{ name: CLEANUP, args: [{ notificationId, cursor: null }], time: deleteAt, state: 'pending' }
		]);
	});

	it('cancels the pending send and finishes the row', async () => {
		const t = harness();
		const { threadId, notificationId } = await scheduledThread(t);

		await expect(t.mutation(notifications.cancelPendingNotification, { threadId })).resolves.toBe(
			true
		);

		expect(await jobs(t)).toEqual([
			send(notificationId, START + NOTIFICATION_DELAY_MS, 'canceled')
		]);
		expect(await t.run((ctx) => ctx.db.query('pendingAdminNotifications').take(1))).toEqual([]);
		await expect(t.mutation(notifications.cancelPendingNotification, { threadId })).resolves.toBe(
			false
		);
	});

	it('skips a send whose notification is not claimable', async () => {
		const t = harness();
		const { threadId, notificationId } = await scheduledThread(t);
		await t.mutation(notifications.cancelPendingNotification, { threadId });

		await expect(
			t.action(notifications.sendPendingAdminNotification, { notificationId })
		).resolves.toBeNull();
		expect(await jobs(t)).toHaveLength(1);
	});

	it('reads the thread, the recipients and the messages', async () => {
		const t = harness();
		const { threadId, messageIds } = await seedThread(t);

		await expect(t.query(notifications.getSupportThread, { threadId })).resolves.toMatchObject({
			threadId,
			userName: 'Visitor'
		});
		await expect(
			t.query(notifications.getSupportThread, { threadId: 'thread_missing' })
		).resolves.toBeNull();
		await expect(
			t.query(notifications.getNotificationTargetEmails, { notificationType: 'newTickets' })
		).resolves.toEqual(['admin@example.com']);
		await expect(
			t.query(notifications.getNotificationTargetEmails, { notificationType: 'userReplies' })
		).resolves.toEqual([]);
		await expect(
			t.query(notifications.getMessageContents, { messageIds: [messageIds[0]] })
		).resolves.toEqual([{ text: 'Refund please', timestamp: expect.any(String) }]);
		await expect(
			t.query(notifications.getRecentUserMessages, { threadId, limit: Number.POSITIVE_INFINITY })
		).resolves.toEqual([messageIds[0]]);
	});

	it('lists legacy claims on an unbounded page', async () => {
		const t = harness();
		const legacyId: NotificationId = await t.run((ctx) =>
			ctx.db.insert('pendingAdminNotifications', {
				threadId: 'thread_legacy',
				isReopen: false,
				notificationType: 'newTickets',
				scheduledFor: 1,
				messageIds: [],
				createdAt: 1
			})
		);
		await schedule(t, 'thread_current');
		await schedule(t, 'thread_claimed');
		const claimedRow = await t.run((ctx) =>
			ctx.db
				.query('pendingAdminNotifications')
				.withIndex('by_thread', (q) => q.eq('threadId', 'thread_claimed'))
				.first()
		);
		if (!claimedRow) throw new Error('no claimed row');
		await claim(t, claimedRow._id);

		const result = await t.query(notifications.listLegacyNotificationClaims, {
			paginationOpts: { numItems: Number.POSITIVE_INFINITY, cursor: null }
		});

		expect(result).toEqual({ page: [legacyId], continueCursor: expect.any(String), isDone: true });
	});
});
