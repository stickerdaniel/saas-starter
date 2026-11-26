import { FunctionImpl, GroupImpl } from '@confect/server';
import * as DateTime from 'effect/DateTime';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import type { PaginationOptions } from 'convex/server';
import { components } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import type {
	MutationCtx as ConvexMutationCtx,
	QueryCtx as ConvexQueryCtx
} from '../../convex/_generated/server';
import { isEmailAddress } from '../../effect/schema';
import { normalizeSupportPageRoute } from '../../shared/support-page-route';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx, QueryRunner, Scheduler } from '../_generated/services';
import { authComponent } from '../authServer';
import { SupportRefusal, type SupportRefusalCode } from '../errorCodecs';
import { extractLocaleFromUrl, t } from '../i18n/translations';
import VisitorAccessImpl, { requireOwnedSupportThread } from '../middleware/VisitorAccess.impl';
import { SupportOwner } from '../middleware/VisitorAccess.spec';
import { supportAgent } from './agent';
import { toAgentThreadStatus } from './denormalization';
import { SUPPORT_ERROR_CODES } from './errors';
import { recordSupportMessageContext } from './messageContext';
import type { ThreadHandoffArgsSchema } from './schemas';
import {
	createSupportThreadRecord,
	limitSupportThreadCreate,
	recordFirstSupportContact,
	syncSupportLastMessage
} from './threadLifecycle';
import {
	backfillThreadMetadata,
	EMPTY_THREAD_SWEEP_BATCH_SIZE,
	EMPTY_THREAD_SWEEP_MAX_ATTEMPTS,
	EMPTY_THREAD_SWEEP_MAX_BYTES,
	EMPTY_THREAD_SWEEP_RETRY_MS,
	getThreadLocale,
	syncUserProfile,
	updateThreadMetadata
} from './threadMaintenance';
import threads from './threads.spec';

type AssignedAdmin = { name?: string; image: string | null };
type AdminProfile = { name?: string; image?: string | null };

const DEFAULT_THREAD_TITLE = 'Customer Support';
const NEW_THREAD_SUMMARY = 'New support conversation';
const EMPTY_THREAD_AGE_MS = 24 * 60 * 60 * 1000;

const withMutation = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const withQuery = <A>(run: (ctx: ConvexQueryCtx) => Promise<A>) =>
	QueryCtx.use((ctx) => Effect.promise(() => run(ctx)));

const refuse = (code: SupportRefusalCode) => Effect.fail(new SupportRefusal({ refusal: { code } }));

const requireOwner = Effect.gen(function* () {
	const owner = yield* SupportOwner;
	if (Option.isNone(owner)) return yield* refuse(SUPPORT_ERROR_CODES.authenticationRequired);
	return owner.value;
});

const normalizeNotificationEmail = (email: string) => {
	const normalized = email.trim().toLowerCase();
	if (normalized && !isEmailAddress(normalized)) {
		return refuse(SUPPORT_ERROR_CODES.notificationEmailInvalid);
	}
	return Effect.succeed(normalized || undefined);
};

const toAssignedAdmin = (admin: AdminProfile): AssignedAdmin => ({
	name: admin.name,
	image: admin.image ?? null
});

async function findAdmin(ctx: ConvexQueryCtx, adminId: string) {
	try {
		const admin = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: adminId }],
			select: ['name', 'image']
		})) as AdminProfile | null;
		return admin ? toAssignedAdmin(admin) : undefined;
	} catch {
		console.log({ code: 'support_admin_unavailable', adminId });
		return undefined;
	}
}

async function findAdmins(ctx: ConvexQueryCtx, adminIds: ReadonlySet<string>) {
	const admins = new Map<string, AssignedAdmin>();
	if (adminIds.size === 0) return admins;
	try {
		const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			where: [{ field: '_id', operator: 'in', value: [...adminIds] }],
			paginationOpts: { cursor: null, numItems: adminIds.size },
			select: ['_id', 'name', 'image']
		});
		for (const admin of result.page as Array<AdminProfile & { _id: string }>) {
			admins.set(admin._id, toAssignedAdmin(admin));
		}
	} catch {
		await Promise.all(
			[...adminIds].map(async (adminId) => {
				const admin = await findAdmin(ctx, adminId);
				if (admin) admins.set(adminId, admin);
			})
		);
	}
	return admins;
}

async function listOwnerThreads(
	ctx: ConvexQueryCtx,
	ownerId: string,
	paginationOpts: PaginationOptions = { numItems: 20, cursor: null }
) {
	const supportThreadsPage = await ctx.db
		.query('supportThreads')
		.withIndex('by_user_and_last_message', (q) => q.eq('userId', ownerId))
		.order('desc')
		.paginate(paginationOpts);
	const supportThreads = supportThreadsPage.page.filter((supportThread) => !supportThread.isWarm);
	const admins = await findAdmins(
		ctx,
		new Set(supportThreads.flatMap(({ assignedTo }) => (assignedTo ? [assignedTo] : [])))
	);

	return {
		page: supportThreads.map((supportThread) => ({
			_id: supportThread.threadId,
			_creationTime: supportThread.createdAt,
			userId: supportThread.userId,
			title: supportThread.title,
			summary: supportThread.summary,
			status: toAgentThreadStatus(supportThread.status),
			lastAgentName: supportThread.lastAgentName,
			lastMessageRole: supportThread.lastMessageRole,
			lastMessage: supportThread.lastMessage,
			lastMessageAt: supportThread.lastMessageAt,
			isHandedOff: supportThread.isHandedOff ?? false,
			hasUnreadAdminReply: supportThread.hasUnreadAdminReply ?? false,
			notificationEmail: supportThread.notificationEmail,
			assignedAdmin: supportThread.assignedTo ? admins.get(supportThread.assignedTo) : undefined
		})),
		isDone: supportThreadsPage.isDone,
		continueCursor: supportThreadsPage.continueCursor
	};
}

async function handOff(
	ctx: ConvexMutationCtx,
	supportThread: Doc<'supportThreads'>,
	{ threadId, pageUrl, appVersion }: typeof ThreadHandoffArgsSchema.Type
) {
	const { messageId } = await supportAgent.saveMessage(ctx, {
		threadId,
		message: { role: 'user', content: 'Talk to support' },
		skipEmbeddings: true
	});
	await recordSupportMessageContext(ctx, { threadId, messageId, pageUrl, appVersion });
	await supportAgent.saveMessage(ctx, {
		threadId,
		message: {
			role: 'assistant',
			content: t(extractLocaleFromUrl(supportThread.pageUrl), 'backend.support.handoff.response')
		},
		skipEmbeddings: true
	});

	const now = Date.now();
	await ctx.db.patch('supportThreads', supportThread._id, {
		isWarm: false,
		isHandedOff: true,
		awaitingAdminResponse: true,
		updatedAt: now
	});
	await recordFirstSupportContact(ctx, supportThread, now);
	await syncSupportLastMessage(ctx, threadId);
}

const recordSweepFailure = (supportThread: Doc<'supportThreads'>) =>
	Effect.gen(function* () {
		const attempts = (supportThread.sweepAttempts ?? 0) + 1;
		if (attempts >= EMPTY_THREAD_SWEEP_MAX_ATTEMPTS) {
			yield* withMutation((ctx) =>
				ctx.db.patch('supportThreads', supportThread._id, {
					sweep: 'failed',
					sweepAttempts: attempts,
					sweepJobId: undefined
				})
			);
			yield* Effect.logWarning('[deleteEmptyThreads] Gave up on a support thread', {
				supportThreadId: supportThread._id,
				attempts
			});
			return;
		}
		const sweepJobId = yield* (yield* Scheduler).runAt(
			DateTime.makeUnsafe(Date.now() + EMPTY_THREAD_SWEEP_RETRY_MS * 2 ** (attempts - 1)),
			refs.internal.support.threads.sweepEmptyThread,
			{ supportThreadId: supportThread._id }
		);
		yield* withMutation((ctx) =>
			ctx.db.patch('supportThreads', supportThread._id, {
				sweep: 'queued',
				sweepAttempts: attempts,
				sweepJobId
			})
		);
	});

const releaseStaleClaims = Effect.gen(function* () {
	const ctx = yield* MutationCtx;
	const { page } = yield* Effect.promise(() =>
		ctx.db
			.query('supportThreads')
			.withIndex('by_sweep', (q) => q.eq('sweep', 'queued'))
			.paginate({
				numItems: EMPTY_THREAD_SWEEP_BATCH_SIZE,
				cursor: null,
				maximumBytesRead: EMPTY_THREAD_SWEEP_MAX_BYTES
			})
	);
	let released = 0;
	for (const supportThread of page) {
		const { sweepJobId } = supportThread;
		const job = sweepJobId
			? yield* Effect.promise(() => ctx.db.system.get('_scheduled_functions', sweepJobId))
			: null;
		const state = job ? job.state.kind : 'canceled';
		if (state === 'pending' || state === 'inProgress') continue;
		if (state === 'failed') {
			yield* recordSweepFailure(supportThread);
		} else {
			yield* Effect.promise(() =>
				ctx.db.patch('supportThreads', supportThread._id, {
					sweep: undefined,
					sweepJobId: undefined
				})
			);
		}
		released++;
	}
	return released;
});

export default GroupImpl.make(databaseSchema, threads).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, threads, 'backfillThreadMetadata', () =>
			Effect.gen(function* () {
				return yield* withMutation(backfillThreadMetadata);
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'createThread', ({ title, pageUrl }) =>
			Effect.gen(function* () {
				const owner = yield* requireOwner;
				return yield* withMutation(async (ctx) => {
					await limitSupportThreadCreate(ctx, owner);
					return await createSupportThreadRecord(ctx, {
						resolvedUserId: owner.ownerId,
						isAnonymous: owner.isAnonymous,
						title: title || DEFAULT_THREAD_TITLE,
						summary: NEW_THREAD_SUMMARY,
						pageUrl,
						awaitingAdminResponse: true
					});
				});
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'deleteEmptyThreads', () =>
			Effect.gen(function* () {
				const released = yield* releaseStaleClaims;
				const ctx = yield* MutationCtx;
				const cutoffTime = Date.now() - EMPTY_THREAD_AGE_MS;
				const { page } = yield* Effect.promise(() =>
					ctx.db
						.query('supportThreads')
						.withIndex('by_sweep', (q) => q.eq('sweep', undefined).lt('_creationTime', cutoffTime))
						.paginate({
							numItems: EMPTY_THREAD_SWEEP_BATCH_SIZE,
							cursor: null,
							maximumBytesRead: EMPTY_THREAD_SWEEP_MAX_BYTES
						})
				);
				const scheduler = yield* Scheduler;
				for (const supportThread of page) {
					const sweepJobId = yield* scheduler.runAfter(
						Duration.zero,
						refs.internal.support.threads.sweepEmptyThread,
						{ supportThreadId: supportThread._id }
					);
					yield* Effect.promise(() =>
						ctx.db.patch('supportThreads', supportThread._id, { sweep: 'queued', sweepJobId })
					);
				}
				return { scheduled: page.length, released };
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'getAdminAvatars', () =>
			Effect.gen(function* () {
				return yield* withQuery(async (ctx) => {
					const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
						model: 'user',
						paginationOpts: { cursor: null, numItems: 100 },
						where: [{ field: 'role', operator: 'eq', value: 'admin' }],
						select: ['name', 'image']
					});
					return (result.page as AdminProfile[]).map(toAssignedAdmin);
				});
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'getOrCreateWarmThread', (args) =>
			Effect.gen(function* () {
				const pageUrl = normalizeSupportPageRoute(args.pageUrl);
				const owner = yield* requireOwner;
				return yield* withMutation(async (ctx) => {
					const existingWarm = await ctx.db
						.query('supportThreads')
						.withIndex('by_user_warm', (q) => q.eq('userId', owner.ownerId).eq('isWarm', true))
						.first();

					if (existingWarm) {
						if (pageUrl && existingWarm.pageUrl !== pageUrl) {
							await ctx.db.patch('supportThreads', existingWarm._id, {
								pageUrl,
								updatedAt: Date.now()
							});
						}
						return {
							threadId: existingWarm.threadId,
							notificationEmail: existingWarm.notificationEmail
						};
					}

					await limitSupportThreadCreate(ctx, owner);
					return await createSupportThreadRecord(ctx, {
						resolvedUserId: owner.ownerId,
						isAnonymous: owner.isAnonymous,
						title: DEFAULT_THREAD_TITLE,
						summary: NEW_THREAD_SUMMARY,
						pageUrl,
						isWarm: true,
						awaitingAdminResponse: false
					});
				});
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'getThread', ({ threadId }) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const { supportThread } = yield* requireOwnedSupportThread(ctx.db, threadId);
				const thread = yield* Effect.tryPromise({
					try: () => supportAgent.getThreadMetadata(ctx, { threadId }),
					catch: () => new SupportRefusal({ refusal: { code: SUPPORT_ERROR_CODES.threadNotFound } })
				});
				const adminId = supportThread.assignedTo;
				const assignedAdmin = adminId
					? yield* Effect.promise(() => findAdmin(ctx, adminId))
					: undefined;

				return {
					...thread,
					status: toAgentThreadStatus(supportThread.status),
					isHandedOff: supportThread.isHandedOff ?? false,
					lastAdminReplyAt: supportThread.lastAdminReplyAt,
					lastAdminReplyMessageId: supportThread.lastAdminReplyMessageId,
					userReadAt: supportThread.userReadAt,
					hasUnreadAdminReply: supportThread.hasUnreadAdminReply ?? false,
					notificationEmail: supportThread.notificationEmail,
					assignedAdmin
				};
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'getThreadLocale', ({ threadId }) =>
			Effect.gen(function* () {
				return yield* withQuery((ctx) => getThreadLocale(ctx, threadId));
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'listThreads', ({ paginationOpts }) =>
			Effect.gen(function* () {
				const owner = yield* SupportOwner;
				if (Option.isNone(owner)) return { page: [], isDone: true, continueCursor: '' };
				return yield* withQuery((ctx) =>
					listOwnerThreads(ctx, owner.value.ownerId, paginationOpts)
				);
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'sweepEmptyThread', ({ supportThreadId }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const supportThread = yield* Effect.promise(() =>
					ctx.db.get('supportThreads', supportThreadId)
				);
				if (supportThread?.sweep !== 'queued') return null;

				const messages = yield* Effect.option(
					Effect.tryPromise(() =>
						ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
							threadId: supportThread.threadId,
							order: 'asc',
							paginationOpts: { numItems: 1, cursor: null }
						})
					)
				);
				if (Option.isNone(messages)) {
					yield* recordSweepFailure(supportThread);
					return null;
				}
				if (messages.value.page.length > 0) {
					yield* Effect.promise(() =>
						ctx.db.patch('supportThreads', supportThread._id, {
							sweep: 'retained',
							sweepJobId: undefined
						})
					);
					return null;
				}

				const deletion = yield* Effect.option(
					Effect.tryPromise(() =>
						supportAgent.deleteThreadAsync(ctx, { threadId: supportThread.threadId })
					)
				);
				if (Option.isNone(deletion)) {
					yield* recordSweepFailure(supportThread);
					return null;
				}
				yield* Effect.promise(() => ctx.db.delete('supportThreads', supportThread._id));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'syncUserProfile', (args) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				if (args.cursor !== undefined || args.endCursor !== undefined) {
					const user = yield* Effect.promise(() => authComponent.getAnyUserById(ctx, args.userId));
					if (
						!user ||
						(user.name ?? undefined) !== args.userName ||
						user.email !== args.userEmail
					) {
						return null;
					}
				}

				const { next } = yield* Effect.promise(() => syncUserProfile(ctx, args));
				const scheduler = yield* Scheduler;
				yield* Effect.forEach(
					next,
					(range) =>
						scheduler.runAfter(Duration.zero, refs.internal.support.threads.syncUserProfile, {
							userId: args.userId,
							userName: args.userName,
							userEmail: args.userEmail,
							...range
						}),
					{ discard: true }
				);
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'updateLastMessage', ({ threadId }) =>
			Effect.gen(function* () {
				yield* withMutation((ctx) => syncSupportLastMessage(ctx, threadId));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'updateNotificationEmail', ({ threadId, email }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const { supportThread } = yield* requireOwnedSupportThread(ctx.db, threadId);
				const notificationEmail = yield* normalizeNotificationEmail(email);
				yield* Effect.promise(() =>
					ctx.db.patch('supportThreads', supportThread._id, {
						notificationEmail,
						updatedAt: Date.now()
					})
				);
				return true;
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'updateThreadHandoff', (args) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const { supportThread } = yield* requireOwnedSupportThread(ctx.db, args.threadId);
				if (supportThread.isHandedOff) return true;

				yield* Effect.promise(() => handOff(ctx, supportThread, args));
				const messageIds = yield* (yield* QueryRunner)
					.runQuery(refs.internal.admin.support.notifications.getRecentUserMessages, {
						threadId: args.threadId
					})
					.pipe(Effect.orDie);
				yield* (yield* Scheduler).runAfter(
					Duration.zero,
					refs.internal.admin.support.notifications.scheduleAdminNotification,
					{ threadId: args.threadId, messageIds, isReopen: false, notificationType: 'newTickets' }
				);
				return true;
			})
		),
		FunctionImpl.make(databaseSchema, threads, 'updateThreadMetadata', (args) =>
			Effect.gen(function* () {
				yield* withMutation((ctx) => updateThreadMetadata(ctx, args));
				return null;
			})
		)
	]),
	Layer.provide(VisitorAccessImpl),
	GroupImpl.finalize
);
