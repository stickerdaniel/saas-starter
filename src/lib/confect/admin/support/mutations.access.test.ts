// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api, components, internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import authSchema from '../../../convex-components/betterAuth/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { MAX_MESSAGE_FILES, MAX_MESSAGE_LENGTH } from '../../constants';
import { ADMIN_ERROR_CODES, createAdminError } from '../errors';
import { ADMIN_SUPPORT_ERROR_CODES } from './errors';

const betterAuthModules = await preloadModules(
	import.meta.glob('../../../convex-components/betterAuth/**/*.ts')
);

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);
	return t;
};
type Harness = ReturnType<typeof harness>;
type Caller = Pick<Harness, 'mutation'>;

async function createUser(t: Harness, role: 'user' | 'admin', email: string) {
	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: { name: 'Ada', email, emailVerified: true, role, createdAt: now, updatedAt: now }
		}
	})) as { _id: string };
	return user._id;
}

async function signIn(t: Harness, role: 'user' | 'admin', email: string) {
	const now = Date.now();
	const userId = await createUser(t, role, email);
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId,
				token: crypto.randomUUID(),
				expiresAt: now + 60_000,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	return { userId, caller: t.withIdentity({ subject: userId, sessionId: session._id }) };
}

async function refusal(call: Promise<unknown>) {
	const error = await call.then(
		() => undefined,
		(reason: unknown) => reason
	);
	if (!(error instanceof ConvexError)) throw new Error(`Expected a ConvexError, got ${error}`);
	return error.data;
}

const { mutations } = api.admin.support;

const calls = (caller: Caller) => [
	caller.mutation(mutations.addInternalUserNote, { userId: 'customer_1', content: 'Refunded' }),
	caller.mutation(mutations.sendAdminReply, { threadId: 'thread_1', prompt: 'Hello' }),
	caller.mutation(mutations.updateThreadAssignment, { threadId: 'thread_1' }),
	caller.mutation(mutations.updateThreadPriority, { threadId: 'thread_1', priority: 'high' }),
	caller.mutation(mutations.updateThreadStatus, { threadId: 'thread_1', status: 'done' }),
	caller.mutation(mutations.sendAdminReply, {
		threadId: 'thread_1',
		prompt: 'Hello',
		fileIds: undefined
	}),
	caller.mutation(mutations.updateThreadAssignment, {
		threadId: 'thread_1',
		adminUserId: undefined
	}),
	caller.mutation(mutations.updateThreadPriority, { threadId: 'thread_1', priority: undefined })
];

const seedThread = (t: Harness) =>
	t.run((ctx) =>
		ctx.db.insert('supportThreads', {
			threadId: 'thread_1',
			userId: 'customer_1',
			status: 'open',
			isHandedOff: true,
			awaitingAdminResponse: true,
			createdAt: 1,
			updatedAt: 2
		})
	);

const snapshot = (t: Harness) =>
	t.run(async (ctx) => ({
		threads: await ctx.db.query('supportThreads').take(1_000),
		notes: await ctx.db.query('internalUserNotes').take(1_000),
		scheduled: await ctx.db.system.query('_scheduled_functions').take(1_000)
	}));

const scheduled = (t: Harness) =>
	t.run(async (ctx) =>
		(await ctx.db.system.query('_scheduled_functions').take(1_000)).map((job) => ({
			name: job.name,
			args: job.args
		}))
	);

describe('admin support mutations access', () => {
	it('refuses an anonymous caller on every mutation without writing', async () => {
		const t = harness();
		await seedThread(t);
		const before = await snapshot(t);

		const refusals = await Promise.all(calls(t).map(refusal));

		expect(refusals).toEqual(Array(8).fill('Unauthenticated'));
		expect(await snapshot(t)).toEqual(before);
	});

	it('refuses a signed-in non-admin on every mutation without writing', async () => {
		const t = harness();
		await seedThread(t);
		const user = await signIn(t, 'user', 'user@example.com');
		const before = await snapshot(t);

		const refusals = await Promise.all(calls(user.caller).map(refusal));

		expect(refusals).toEqual(
			Array(8).fill(createAdminError(ADMIN_ERROR_CODES.accessRequired).data)
		);
		expect(await snapshot(t)).toEqual(before);
	});
});

describe('admin support mutation refusals', () => {
	it('refuses an unknown thread on every thread mutation without writing', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const assignee = await signIn(t, 'admin', 'assignee@example.com');
		const before = await snapshot(t);
		const threadId = 'thread_missing';

		const refusals = await Promise.all(
			[
				admin.caller.mutation(mutations.sendAdminReply, { threadId, prompt: 'Hello' }),
				admin.caller.mutation(mutations.updateThreadAssignment, {
					threadId,
					adminUserId: assignee.userId
				}),
				admin.caller.mutation(mutations.updateThreadPriority, { threadId, priority: 'low' }),
				admin.caller.mutation(mutations.updateThreadStatus, { threadId, status: 'done' })
			].map(refusal)
		);

		expect(refusals).toEqual(Array(4).fill({ code: ADMIN_SUPPORT_ERROR_CODES.threadNotFound }));
		expect(await snapshot(t)).toEqual(before);
	});

	it('refuses an empty or oversized reply and an empty note without writing', async () => {
		const t = harness();
		await seedThread(t);
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const before = await snapshot(t);

		const empty = await refusal(
			admin.caller.mutation(mutations.sendAdminReply, { threadId: 'thread_1', prompt: '  ' })
		);
		const tooLong = await refusal(
			admin.caller.mutation(mutations.sendAdminReply, {
				threadId: 'thread_1',
				prompt: 'a'.repeat(MAX_MESSAGE_LENGTH + 1)
			})
		);
		const emptyNote = await refusal(
			admin.caller.mutation(mutations.addInternalUserNote, { userId: 'customer_1', content: ' ' })
		);

		expect(empty).toEqual({ code: ADMIN_SUPPORT_ERROR_CODES.emptyMessage });
		expect(JSON.stringify(tooLong)).toBe(
			JSON.stringify({ code: ADMIN_SUPPORT_ERROR_CODES.messageTooLong, maxLength: 2000 })
		);
		expect(emptyNote).toEqual({ code: ADMIN_SUPPORT_ERROR_CODES.emptyNote });
		expect(await snapshot(t)).toEqual(before);
	});

	it('refuses more file ids than the cap before the thread check and any file lookup or write', async () => {
		const t = harness();
		await seedThread(t);
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const before = await snapshot(t);

		const refusals = await Promise.all(
			['thread_1', 'thread_missing'].map((threadId) =>
				refusal(
					admin.caller.mutation(mutations.sendAdminReply, {
						threadId,
						prompt: 'Files',
						fileIds: Array(MAX_MESSAGE_FILES + 1).fill('file_1')
					})
				)
			)
		);

		expect(refusals).toEqual(
			Array(2).fill({ code: ADMIN_SUPPORT_ERROR_CODES.tooManyFiles, maxFiles: MAX_MESSAGE_FILES })
		);
		expect(await snapshot(t)).toEqual(before);
	});

	it('lets a reply with exactly the cap of file ids reach the thread check', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');

		await expect(
			refusal(
				admin.caller.mutation(mutations.sendAdminReply, {
					threadId: 'thread_missing',
					prompt: 'Files',
					fileIds: Array(MAX_MESSAGE_FILES).fill('file_1')
				})
			)
		).resolves.toEqual({ code: ADMIN_SUPPORT_ERROR_CODES.threadNotFound });
	});

	it('refuses an assignee who is not an admin without writing', async () => {
		const t = harness();
		await seedThread(t);
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const userId = await createUser(t, 'user', 'user@example.com');
		const before = await snapshot(t);

		const refusals = await Promise.all(
			[userId, 'missing_user', ''].map((adminUserId) =>
				refusal(
					admin.caller.mutation(mutations.updateThreadAssignment, {
						threadId: 'thread_1',
						adminUserId
					})
				)
			)
		);

		expect(refusals).toEqual(Array(3).fill({ code: ADMIN_SUPPORT_ERROR_CODES.assigneeNotAdmin }));
		expect(await snapshot(t)).toEqual(before);
	});
});

describe('admin support mutations as an admin', () => {
	it('closes, prioritizes and assigns a thread and cancels its admin notification', async () => {
		const t = harness();
		const threadDoc = await seedThread(t);
		const admin = await signIn(t, 'admin', 'admin@example.com');
		const cancel = {
			name: 'admin/support/notifications:cancelPendingNotification',
			args: [{ threadId: 'thread_1' }]
		};

		await admin.caller.mutation(mutations.updateThreadPriority, {
			threadId: 'thread_1',
			priority: 'high'
		});
		expect(await scheduled(t)).toEqual([]);
		await admin.caller.mutation(mutations.updateThreadStatus, {
			threadId: 'thread_1',
			status: 'open'
		});
		expect(await scheduled(t)).toEqual([]);
		await admin.caller.mutation(mutations.updateThreadStatus, {
			threadId: 'thread_1',
			status: 'done'
		});
		expect(await scheduled(t)).toEqual([cancel]);
		await admin.caller.mutation(mutations.updateThreadAssignment, {
			threadId: 'thread_1',
			adminUserId: admin.userId
		});

		expect(await scheduled(t)).toEqual([cancel, cancel]);
		expect(await t.run((ctx) => ctx.db.get('supportThreads', threadDoc))).toMatchObject({
			status: 'done',
			priority: 'high',
			assignedTo: admin.userId
		});
	});

	it('clears the priority and the assignee given explicit undefined', async () => {
		const t = harness();
		const threadDoc = await seedThread(t);
		const admin = await signIn(t, 'admin', 'admin@example.com');
		await t.run((ctx) =>
			ctx.db.patch('supportThreads', threadDoc, { priority: 'high', assignedTo: admin.userId })
		);

		await admin.caller.mutation(mutations.updateThreadPriority, {
			threadId: 'thread_1',
			priority: undefined
		});
		await admin.caller.mutation(mutations.updateThreadAssignment, {
			threadId: 'thread_1',
			adminUserId: undefined
		});

		const thread = await t.run((ctx) => ctx.db.get('supportThreads', threadDoc));
		expect(thread).not.toHaveProperty('priority');
		expect(thread).not.toHaveProperty('assignedTo');
		expect(await scheduled(t)).toEqual([]);
	});

	it('stores a trimmed internal note under the signed-in admin', async () => {
		const t = harness();
		const admin = await signIn(t, 'admin', 'admin@example.com');

		await admin.caller.mutation(mutations.addInternalUserNote, {
			userId: 'customer_1',
			content: '  Refunded March  '
		});

		expect(await t.run((ctx) => ctx.db.query('internalUserNotes').take(1_000))).toMatchObject([
			{ userId: 'customer_1', adminUserId: admin.userId, content: 'Refunded March' }
		]);
	});
});

describe('admin support notification delivery without identity', () => {
	const seedNotification = (t: Harness) =>
		t.run((ctx) =>
			ctx.db.insert('pendingAdminNotifications', {
				threadId: 'thread_1',
				isReopen: false,
				notificationType: 'newTickets',
				scheduledFor: 1,
				messageIds: [],
				createdAt: 1
			})
		);

	it('refuses to enqueue a recipient for an unclaimed notification', async () => {
		const t = harness();
		const notificationId = await seedNotification(t);

		await expect(
			t.mutation(internal.admin.support.notificationDelivery.enqueueRecipient, {
				notificationId,
				generation: 'generation_1',
				claimToken: 'claim_1',
				email: 'admin@example.com',
				isReopen: false,
				isBareHandoff: false,
				userName: 'Ada',
				messages: [{ text: 'Hello', timestamp: '10:00' }],
				threadId: 'thread_1'
			})
		).resolves.toBe(false);
		expect(await t.run((ctx) => ctx.db.query('supportNotificationReceipts').take(1_000))).toEqual(
			[]
		);
	});

	it('deletes one page of receipts and schedules the rest 250 ms later', async () => {
		const t = harness();
		const notificationId = await seedNotification(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < 101; index++)
				await ctx.db.insert('supportNotificationReceipts', {
					notificationId,
					generation: 'generation_1',
					email: `admin${String(index).padStart(3, '0')}@example.com`
				});
		});

		const start = Date.now();
		await expect(
			t.mutation(internal.admin.support.notificationDelivery.cleanupReceipts, {
				notificationId,
				cursor: null
			})
		).resolves.toBeNull();
		const end = Date.now();

		const remaining = await t.run((ctx) => ctx.db.query('supportNotificationReceipts').take(1_000));
		expect(remaining).toHaveLength(1);
		const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').take(1_000));
		expect(jobs).toMatchObject([
			{
				name: 'admin/support/notificationDelivery:cleanupReceipts',
				args: [{ notificationId, cursor: expect.any(String) }]
			}
		]);
		expect(jobs[0].scheduledTime).toBeGreaterThanOrEqual(start + 250);
		expect(jobs[0].scheduledTime).toBeLessThanOrEqual(end + 250);
	});
});
