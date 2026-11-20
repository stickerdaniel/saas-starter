import { components, internal } from './_generated/api';
import {
	query,
	mutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { v, type Infer } from 'convex/values';
import { createFunctionHandle } from 'convex/server';
import type { Doc, Id } from './_generated/dataModel';
import { supportAgent } from '../confect/support/agent';
import { isAnonymousUser } from '../confect/utils/anonymousUser';
import { incrementCounter, recalculateCounters } from '../confect/admin/counters';
import { aiChatRateLimiter } from '../confect/aiChat/rateLimit';
import { getAiChatSidebarActivityAt } from '../confect/aiChat/visibility';

/** Throws unless `secret` matches AUTH_E2E_TEST_SECRET, which only test environments set. */
function requireTestSecret(secret: string): void {
	const expected = process.env.AUTH_E2E_TEST_SECRET;
	if (!expected || secret !== expected) {
		throw new Error('Unauthorized: Invalid test secret');
	}
}

/**
 * Check the run token an E2E spec registered in its ownership ledger before a
 * fixture seed. Recovery deletes a fixture by this token, so a malformed or empty
 * token could otherwise widen a prefix match.
 */
function requireFixtureToken(token: string): void {
	if (!/^e2e-fixture-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) {
		throw new Error('Invalid E2E fixture token');
	}
}

const supportRecoveryFixturePrefix = '__support-recovery-test:';

/** Cancels the fixture's own scheduled jobs and deletes its row; no other notification is touched. */
async function deleteSupportRecoveryFixture(
	ctx: MutationCtx,
	row: Doc<'pendingAdminNotifications'>
): Promise<void> {
	if (!row.threadId.startsWith(supportRecoveryFixturePrefix))
		throw new Error('Not a recovery fixture');
	for (const id of [row.scheduledFnId, row.recoveryFnId])
		if (id && (await ctx.db.system.get(id))?.state.kind === 'pending')
			await ctx.scheduler.cancel(id);
	await ctx.db.delete('pendingAdminNotifications', row._id);
}

export const seedSupportNotificationClaim = mutation({
	args: { secret: v.string(), fixtureToken: v.string() },
	returns: v.object({
		notificationId: v.id('pendingAdminNotifications'),
		generation: v.string(),
		claimToken: v.string(),
		deadline: v.number()
	}),
	handler: async (
		ctx,
		args
	): Promise<{
		notificationId: Id<'pendingAdminNotifications'>;
		generation: string;
		claimToken: string;
		deadline: number;
	}> => {
		requireTestSecret(args.secret);
		requireFixtureToken(args.fixtureToken);
		const notificationId = await ctx.db.insert('pendingAdminNotifications', {
			threadId: supportRecoveryFixturePrefix + args.fixtureToken,
			messageIds: [],
			isReopen: false,
			notificationType: 'newTickets',
			createdAt: Date.now(),
			scheduledFor: Date.now() + 3600000
		});
		const scheduledFnId = await ctx.scheduler.runAfter(
			3600000,
			internal.admin.support.notifications.sendPendingAdminNotification,
			{ notificationId }
		);
		await ctx.db.patch('pendingAdminNotifications', notificationId, { scheduledFnId });
		const claim = await ctx.runMutation(
			internal.admin.support.notifications.claimNotificationForSending,
			{ notificationId, issueToken: true, receiptProtocol: 1 }
		);
		if (!claim) throw new Error('Fixture claim failed');
		await ctx.scheduler.cancel(scheduledFnId);
		const row = await ctx.db.get('pendingAdminNotifications', notificationId);
		return {
			notificationId,
			generation: claim.generation,
			claimToken: claim.claimToken,
			deadline: row!.claimLeaseExpiresAt!
		};
	}
});

export const recoverSupportNotificationFixture = mutation({
	args: {
		secret: v.string(),
		notificationId: v.id('pendingAdminNotifications'),
		generation: v.string(),
		claimToken: v.string()
	},
	returns: v.object({
		recovered: v.boolean(),
		duplicateRecovered: v.boolean(),
		staleDeleted: v.boolean(),
		retryCount: v.number(),
		sameGeneration: v.boolean(),
		scheduled: v.boolean(),
		claimCleared: v.boolean()
	}),
	handler: async (
		ctx,
		args
	): Promise<{
		recovered: boolean;
		duplicateRecovered: boolean;
		staleDeleted: boolean;
		retryCount: number;
		sameGeneration: boolean;
		scheduled: boolean;
		claimCleared: boolean;
	}> => {
		requireTestSecret(args.secret);
		const row = await ctx.db.get('pendingAdminNotifications', args.notificationId);
		if (!row?.threadId.startsWith(supportRecoveryFixturePrefix))
			throw new Error('Not a recovery fixture');
		const deadline = Date.now() - 1;
		await ctx.db.patch('pendingAdminNotifications', row._id, { claimLeaseExpiresAt: deadline });
		const recovery = {
			notificationId: row._id,
			generation: args.generation,
			claimToken: args.claimToken,
			deadline
		};
		const recovered = await ctx.runMutation(
			internal.admin.support.notifications.recoverNotificationClaim,
			recovery
		);
		const duplicateRecovered = await ctx.runMutation(
			internal.admin.support.notifications.recoverNotificationClaim,
			recovery
		);
		const staleDeleted = await ctx.runMutation(
			internal.admin.support.notifications.deletePendingNotification,
			{ notificationId: row._id, claimToken: args.claimToken }
		);
		const current = await ctx.db.get('pendingAdminNotifications', row._id);
		return {
			recovered,
			duplicateRecovered,
			staleDeleted,
			retryCount: current?.retryCount ?? 0,
			sameGeneration: current?.generation === args.generation,
			scheduled: current?.scheduledFnId !== undefined,
			claimCleared: current?.claimToken === undefined
		};
	}
});

export const deleteSupportNotificationFixture = mutation({
	args: { secret: v.string(), notificationId: v.id('pendingAdminNotifications') },
	returns: v.null(),
	handler: async (ctx, args) => {
		requireTestSecret(args.secret);
		const row = await ctx.db.get('pendingAdminNotifications', args.notificationId);
		if (row) await deleteSupportRecoveryFixture(ctx, row);
		return null;
	}
});

/**
 * Health probe used by e2e/global-setup.ts to gate the first signup HTTP call
 * on actual Convex backend readiness. The convex-vite-plugin starts backend
 * deploy asynchronously after vite begins serving, so a cold backend can 500
 * even though Playwright's webServer port-check has already succeeded.
 *
 * Gated by AUTH_E2E_TEST_SECRET so it doubles as a propagation check: if the
 * secret didn't reach the backend (vite.config.ts envVars wiring), this
 * returns Unauthorized and globalSetup fails fast with a clear error.
 */
export const health = query({
	args: { secret: v.string() },
	returns: v.object({ ok: v.boolean() }),
	handler: async (_ctx, { secret }) => {
		requireTestSecret(secret);
		return { ok: true };
	}
});

/** Seeds registry rows whose thread IDs all start with `<fixtureToken>-`, the key recovery deletes by. */
export const seedAiChatHistoryRows = mutation({
	args: {
		secret: v.string(),
		fixtureToken: v.string(),
		userId: v.string(),
		rows: v.array(
			v.object({
				threadId: v.string(),
				createdAt: v.number(),
				isWarm: v.optional(v.boolean()),
				lastMessage: v.optional(v.string()),
				lastMessageAt: v.optional(v.number())
			})
		)
	},
	returns: v.array(v.id('aiChatThreads')),
	handler: async (ctx, args) => {
		requireTestSecret(args.secret);
		requireFixtureToken(args.fixtureToken);
		if (args.rows.length > 100) throw new Error('History fixture exceeds 100 rows');
		if (args.rows.some((row) => !row.threadId.startsWith(`${args.fixtureToken}-`)))
			throw new Error('History fixture thread IDs must start with the fixture token');
		const ids = [];
		// A bounded fixture owns only the registry rows returned for cleanup.
		for (const row of args.rows)
			ids.push(
				await ctx.db.insert('aiChatThreads', {
					...row,
					userId: args.userId,
					sidebarActivityAt: getAiChatSidebarActivityAt(row)
				})
			);
		return ids;
	}
});

export const deleteAiChatHistoryRows = mutation({
	args: { secret: v.string(), ids: v.array(v.id('aiChatThreads')) },
	returns: v.null(),
	handler: async (ctx, args) => {
		requireTestSecret(args.secret);
		if (args.ids.length > 100) throw new Error('History cleanup exceeds 100 rows');
		// E2E cleanup deletes at most 100 small fixture rows in one transaction.
		for (const id of args.ids) await ctx.db.delete('aiChatThreads', id);
		return null;
	}
});

/** Seeds ban/unban rows whose reason starts with `<fixtureToken>:`, the key recovery deletes by. */
export const seedAuditLogRows = mutation({
	args: {
		secret: v.string(),
		fixtureToken: v.string(),
		fixtureId: v.string(),
		count: v.number(),
		offset: v.number(),
		reasonBytes: v.optional(v.number())
	},
	returns: v.array(v.id('adminAuditLogs')),
	handler: async (ctx, args) => {
		requireTestSecret(args.secret);
		requireFixtureToken(args.fixtureToken);
		if (!Number.isInteger(args.count) || args.count < 1 || args.count > 100) {
			throw new Error('Invalid audit fixture');
		}
		const reason = `${args.fixtureToken}:${'x'.repeat(Math.min(2048, Math.max(0, args.reasonBytes ?? 20)))}`;
		const ids = [];
		// At most 100 rows with capped metadata fit in one fixture transaction.
		for (let i = 0; i < args.count; i++) {
			ids.push(
				await ctx.db.insert('adminAuditLogs', {
					adminUserId: args.fixtureId,
					targetUserId: args.fixtureId,
					action: i % 2 === 0 ? 'ban_user' : 'unban_user',
					timestamp: args.offset + i,
					metadata: { reason }
				})
			);
		}
		return ids;
	}
});

/**
 * Delete exactly the audit rows `seedAuditLogRows` returned. Never select by
 * user id: a fixture id can name a real admin whose history must survive.
 */
export const deleteAuditLogRows = mutation({
	args: { secret: v.string(), ids: v.array(v.id('adminAuditLogs')) },
	returns: v.null(),
	handler: async (ctx, args) => {
		requireTestSecret(args.secret);
		if (args.ids.length > 100) throw new Error('Audit cleanup exceeds 100 rows');
		// E2E cleanup deletes at most 100 small fixture rows in one transaction.
		for (const id of args.ids) await ctx.db.delete('adminAuditLogs', id);
		return null;
	}
});

export const getLegacyAuditLogCursor = query({
	args: {
		secret: v.string(),
		fixtureId: v.string(),
		direction: v.union(v.literal('asc'), v.literal('desc'))
	},
	returns: v.string(),
	handler: async (ctx, args) => {
		requireTestSecret(args.secret);
		const result = await ctx.db
			.query('adminAuditLogs')
			.withIndex('by_admin', (q) => q.eq('adminUserId', args.fixtureId))
			.order(args.direction)
			.paginate({ numItems: 20, cursor: null });
		return result.continueCursor;
	}
});

function buildSearchText(fields: {
	title?: string;
	summary?: string;
	userName?: string;
	userEmail?: string;
}): string {
	return (
		[fields.title, fields.summary, fields.userName, fields.userEmail]
			.filter(Boolean)
			.join(' | ')
			.toLowerCase() || 'untitled'
	);
}

export const getTestUser = internalQuery({
	args: { email: v.string() },
	// v.any(): user doc shape is owned by the Better Auth component, not this app
	returns: v.any(),
	handler: async (ctx, { email }) => {
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});
		return user;
	}
});

// Marks a test user's email verified, bypassing the email verification flow
export const verifyTestUserEmail = mutation({
	args: { email: v.string(), secret: v.string() },
	returns: v.object({
		success: v.boolean(),
		error: v.optional(v.string()),
		alreadyVerified: v.optional(v.boolean())
	}),
	handler: async (ctx, { email, secret }) => {
		requireTestSecret(secret);

		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { success: false, error: 'User not found' };
		}

		if (user.emailVerified) {
			return { success: true, alreadyVerified: true };
		}

		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: 'email', value: email }],
				update: { emailVerified: true }
			}
		});

		return { success: true };
	}
});

// Promotes an existing test user, created via signup, to admin and verifies the email
export const createTestAdminUser = mutation({
	args: { email: v.string(), secret: v.string() },
	returns: v.object({
		success: v.boolean(),
		error: v.optional(v.string()),
		alreadyAdmin: v.optional(v.boolean()),
		alreadyVerified: v.optional(v.boolean()),
		wasAdmin: v.optional(v.boolean()),
		wasVerified: v.optional(v.boolean())
	}),
	handler: async (ctx, { email, secret }) => {
		requireTestSecret(secret);

		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { success: false, error: 'User not found. Sign up the user first.' };
		}

		if (user.role === 'admin' && user.emailVerified) {
			return { success: true, alreadyAdmin: true, alreadyVerified: true };
		}

		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: 'email', value: email }],
				update: { role: 'admin', emailVerified: true }
			}
		});
		// This raw update skips the auth triggers, so count the promotion here; the
		// delete trigger decrements it again when the fixture is removed.
		if (user.role !== 'admin') await incrementCounter(ctx, 'adminCount', 1);

		// The admin-settings E2E tests need the admin's notification preferences row
		const existingPref = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();

		if (!existingPref) {
			await ctx.db.insert('adminNotificationPreferences', {
				email,
				userId: user._id,
				isAdminUser: true,
				notifyNewSupportTickets: true,
				notifyUserReplies: true,
				notifyNewSignups: true,
				notifyNewCustomers: true,
				notifyCancellations: true,
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		}

		return {
			success: true,
			wasAdmin: user.role === 'admin',
			wasVerified: user.emailVerified === true
		};
	}
});

// Most support threads one fixture call may create or delete. Each thread costs an agent
// component call plus its own reads and writes; 105 in one transaction ran past Convex's
// limit on time spent in system operations on preview backends, so callers split larger
// sets across calls.
const SUPPORT_THREAD_FIXTURE_BATCH = 25;

// `count` creates several threads for pagination tests
export const createAnonymousSupportThread = mutation({
	args: {
		secret: v.string(),
		anonymousUserId: v.string(),
		title: v.optional(v.string()),
		pageUrl: v.optional(v.string()),
		count: v.optional(v.number())
	},
	returns: v.object({ threadIds: v.array(v.string()), anonymousUserId: v.string() }),
	handler: async (ctx, { secret, anonymousUserId, title, pageUrl, count = 1 }) => {
		requireTestSecret(secret);

		if (!isAnonymousUser(anonymousUserId)) {
			throw new Error('Invalid anonymous user ID');
		}
		if (!Number.isInteger(count) || count < 1 || count > SUPPORT_THREAD_FIXTURE_BATCH) {
			throw new Error(`count must be an integer between 1 and ${SUPPORT_THREAD_FIXTURE_BATCH}`);
		}

		const threadIds: string[] = [];

		for (let i = 0; i < count; i++) {
			const threadTitle =
				count > 1 ? `${title ?? 'E2E Support Thread'} #${i + 1}` : (title ?? 'E2E Support Thread');
			const summary = 'New support conversation';
			const searchText = buildSearchText({ title: threadTitle, summary });

			const { threadId } = await supportAgent.createThread(ctx, {
				userId: anonymousUserId,
				title: threadTitle,
				summary
			});

			await ctx.db.insert('supportThreads', {
				threadId,
				userId: anonymousUserId,
				status: 'open',
				isHandedOff: false,
				awaitingAdminResponse: true,
				assignedTo: undefined,
				priority: undefined,
				pageUrl: pageUrl || undefined,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				notificationEmail: undefined,
				searchText,
				title: threadTitle,
				summary,
				lastMessage: undefined,
				userName: undefined,
				userEmail: undefined
			});

			threadIds.push(threadId);
		}

		return { threadIds, anonymousUserId };
	}
});

/** Create one anonymous ticket whose latest human reply has not been read. */
export const createUnreadAnonymousSupportReply = mutation({
	args: {
		secret: v.string(),
		anonymousUserId: v.string(),
		newerThreadCount: v.optional(v.number()),
		/** The route the customer's message was sent from, past the thread's own `/`. */
		messageRoute: v.optional(v.string()),
		/** The build the customer's tab reported with the message. */
		messageAppVersion: v.optional(v.string())
	},
	returns: v.object({
		threadId: v.string(),
		threadIds: v.array(v.string()),
		reply: v.string()
	}),
	handler: async (
		ctx,
		{ secret, anonymousUserId, newerThreadCount = 0, messageRoute, messageAppVersion }
	) => {
		requireTestSecret(secret);
		if (!isAnonymousUser(anonymousUserId)) throw new Error('Invalid anonymous user ID');
		if (!Number.isInteger(newerThreadCount) || newerThreadCount < 0 || newerThreadCount > 20) {
			throw new Error('newerThreadCount must be an integer between 0 and 20');
		}

		const title = 'E2E unread support reply';
		const userMessage = 'E2E support request';
		const reply = 'E2E support team reply';
		const replyTimestamp = Date.now();
		const { threadId } = await supportAgent.createThread(ctx, {
			userId: anonymousUserId,
			title,
			summary: userMessage
		});

		const request = await supportAgent.saveMessage(ctx, {
			threadId,
			prompt: userMessage,
			skipEmbeddings: true
		});
		if (messageRoute || messageAppVersion) {
			await ctx.db.insert('supportMessageContexts', {
				threadId,
				messageId: request.messageId,
				...(messageRoute ? { pageUrl: messageRoute } : {}),
				...(messageAppVersion ? { appVersion: messageAppVersion } : {}),
				createdAt: replyTimestamp
			});
		}
		const adminReply = await supportAgent.saveMessage(ctx, {
			threadId,
			message: { role: 'assistant', content: reply },
			metadata: { provider: 'human' },
			skipEmbeddings: true
		});

		await ctx.db.insert('supportThreads', {
			threadId,
			userId: anonymousUserId,
			status: 'open',
			isHandedOff: true,
			awaitingAdminResponse: false,
			pageUrl: '/',
			createdAt: replyTimestamp,
			updatedAt: replyTimestamp,
			searchText: `${title} | ${userMessage} | ${reply}`.toLowerCase(),
			title,
			summary: userMessage,
			lastMessage: reply,
			lastMessageAt: replyTimestamp,
			lastMessageRole: 'assistant',
			lastAgentName: 'Support Team',
			lastAdminReplyAt: replyTimestamp,
			lastAdminReplyMessageId: adminReply.messageId,
			hasUnreadAdminReply: true,
			unreadAdminReplyCount: 1
		});

		const threadIds = [threadId];
		for (let index = 0; index < newerThreadCount; index++) {
			const newerTitle = `E2E newer support thread ${index + 1}`;
			const newerMessage = `E2E newer message ${index + 1}`;
			const timestamp = replyTimestamp + index + 1;
			const { threadId: newerThreadId } = await supportAgent.createThread(ctx, {
				userId: anonymousUserId,
				title: newerTitle,
				summary: newerMessage
			});

			await ctx.db.insert('supportThreads', {
				threadId: newerThreadId,
				userId: anonymousUserId,
				status: 'open',
				isHandedOff: false,
				awaitingAdminResponse: true,
				pageUrl: '/',
				createdAt: timestamp,
				updatedAt: timestamp,
				searchText: `${newerTitle} | ${newerMessage}`.toLowerCase(),
				title: newerTitle,
				summary: newerMessage,
				lastMessage: newerMessage,
				lastMessageAt: timestamp,
				lastMessageRole: 'user'
			});
			threadIds.push(newerThreadId);
		}

		return { threadId, threadIds, reply };
	}
});

export const getSupportThreadsByUserId = mutation({
	args: {
		secret: v.string(),
		userId: v.string()
	},
	returns: v.array(
		v.object({
			threadId: v.string(),
			userId: v.optional(v.string()),
			userName: v.optional(v.string()),
			userEmail: v.optional(v.string())
		})
	),
	handler: async (ctx, { secret, userId }) => {
		requireTestSecret(secret);

		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Bounded: per-user index scan over test-created support threads (test-only, small dataset)
		const threads = await ctx.db
			.query('supportThreads')
			.withIndex('by_user_warm', (q) => q.eq('userId', userId))
			.collect();

		return threads.map((t) => ({
			threadId: t.threadId,
			userId: t.userId,
			userName: t.userName,
			userEmail: t.userEmail
		}));
	}
});

export const getAuthUserIdByEmail = mutation({
	args: {
		secret: v.string(),
		email: v.string()
	},
	returns: v.object({ userId: v.union(v.string(), v.null()) }),
	handler: async (ctx, { secret, email }) => {
		requireTestSecret(secret);

		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { userId: null };
		}

		return { userId: user._id };
	}
});

/**
 * Reset one test user's AI chat upload limit.
 *
 * All tests of one E2E worker share its user, and the upload grant allows ten
 * per hour. A later test that needs a transfer still in flight otherwise has its
 * grant refused, the transfer ends, and leaving the page is correctly allowed.
 */
export const resetAiChatFileUploadLimit = mutation({
	args: { secret: v.string(), email: v.string() },
	returns: v.null(),
	handler: async (ctx, { secret, email }) => {
		requireTestSecret(secret);
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});
		if (!user) throw new Error(`No test user for ${email}`);
		await aiChatRateLimiter.reset(ctx, 'aiChatFileUpload', { key: user._id });
		return null;
	}
});

// Reset emails are skipped for @e2e.example.com addresses (emails/helpers.ts),
// so E2E tests read the token Better Auth stored in the verification model.
export const getPasswordResetToken = mutation({
	args: { email: v.string(), secret: v.string() },
	returns: v.object({ token: v.union(v.string(), v.null()) }),
	handler: async (ctx, { email, secret }) => {
		requireTestSecret(secret);

		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { token: null };
		}

		const RESET_PREFIX = 'reset-password:';

		// Unindexed scan over the verification model (test-only, table stays tiny on e2e backends)
		const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'verification',
			where: [
				{ field: 'value', value: user._id },
				{ field: 'identifier', operator: 'starts_with', value: RESET_PREFIX }
			],
			paginationOpts: { numItems: 100, cursor: null }
		});

		const latest = (result.page as Array<{ identifier?: string; _creationTime?: number }>).sort(
			(a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0)
		)[0];

		const token = latest?.identifier?.startsWith(RESET_PREFIX)
			? latest.identifier.slice(RESET_PREFIX.length)
			: null;

		return { token };
	}
});

const SUPPORT_MESSAGE_CONTEXT_DELETE_BATCH = 100;

export const cleanupAnonymousSupportThreads = mutation({
	args: {
		secret: v.string(),
		threadIds: v.array(v.string())
	},
	returns: v.object({
		success: v.boolean(),
		deletedSupportThreads: v.number(),
		deletedAgentThreads: v.number()
	}),
	handler: async (ctx, { secret, threadIds }) => {
		requireTestSecret(secret);
		if (threadIds.length > SUPPORT_THREAD_FIXTURE_BATCH) {
			throw new Error(`Pass at most ${SUPPORT_THREAD_FIXTURE_BATCH} threadIds per call`);
		}

		let deletedSupportThreads = 0;
		let deletedAgentThreads = 0;

		for (const threadId of threadIds) {
			// Bounded per batch; the loop ends on the first short batch.
			while (true) {
				const contexts = await ctx.db
					.query('supportMessageContexts')
					.withIndex('by_thread', (q) => q.eq('threadId', threadId))
					.take(SUPPORT_MESSAGE_CONTEXT_DELETE_BATCH);
				for (const context of contexts) {
					await ctx.db.delete('supportMessageContexts', context._id);
				}
				if (contexts.length < SUPPORT_MESSAGE_CONTEXT_DELETE_BATCH) break;
			}

			try {
				await supportAgent.deleteThreadAsync(ctx, { threadId, pageSize: 100 });
				deletedAgentThreads++;
			} catch {
				console.warn({ code: 'anonymous_thread_delete_failed', threadId });
			}

			const supportThread = await ctx.db
				.query('supportThreads')
				.withIndex('by_thread', (q) => q.eq('threadId', threadId))
				.first();

			if (supportThread) {
				await ctx.db.delete('supportThreads', supportThread._id);
				deletedSupportThreads++;
			}
		}

		return {
			success: true,
			deletedSupportThreads,
			deletedAgentThreads
		};
	}
});

// globalTeardown deletes each run's fresh test users with their accounts and sessions
export const deleteTestUser = mutation({
	args: { email: v.string(), secret: v.string() },
	returns: v.object({
		success: v.boolean(),
		error: v.optional(v.string()),
		deletedEmail: v.optional(v.string()),
		accountsDeleted: v.optional(v.number()),
		sessionsDeleted: v.optional(v.number()),
		verificationsDeleted: v.optional(v.number())
	}),
	handler: async (ctx, { email, secret }) => {
		requireTestSecret(secret);

		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: email }]
		});

		if (!user) {
			return { success: false, error: 'User not found' };
		}
		// The component runs the app's auth delete triggers only when handed this
		// handle, as Better Auth's own adapter does. Without it a removed fixture
		// keeps its dashboard counts, journey records and impersonation audit.
		const onDeleteHandle = await createFunctionHandle(internal.auth.onDelete);

		// Page through deletions with the component's own cursor. `deleteMany` reports
		// `count` and `isDone`, and an unindexed `where` makes them diverge: the scan
		// stops after a fixed number of source rows, so a page can match nothing and
		// still not be the last one. Continuing on a zero count is what makes the
		// unindexed pass below terminate at the right place instead of the first page.
		// The page callback keeps its literal model at the call site, which is what lets
		// the component's per-model `where` validator narrow.
		const deleteAll = async (
			deletePage: (
				cursor: string | null
			) => Promise<{ count: number; isDone: boolean; continueCursor: string }>
		) => {
			let deleted = 0;
			let cursor: string | null = null;
			let isDone = false;
			while (!isDone) {
				const result = await deletePage(cursor);
				deleted += result.count;
				isDone = result.isDone;
				cursor = result.continueCursor;
			}
			return deleted;
		};

		const accountsDeleted = await deleteAll((cursor) =>
			ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input: { model: 'account', where: [{ field: 'userId', value: user._id }] },
				paginationOpts: { numItems: 100, cursor }
			})
		);
		const sessionsDeleted = await deleteAll((cursor) =>
			ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input: { model: 'session', where: [{ field: 'userId', value: user._id }] },
				paginationOpts: { numItems: 100, cursor },
				onDeleteHandle
			})
		);

		// A password-reset request stores its token under `reset-password:<token>` with
		// the user id as the value, and email verification stores it under the address,
		// so neither is reachable by userId. Better Auth only clears them when the token
		// is consumed or looked up after expiry, so a suite that requests a reset without
		// completing it would leave them behind for the lifetime of the backend.
		// Both passes are indexed: `value` carries a custom index in the local schema
		// for this one, because an unindexed scan here shares the caller's
		// transaction budget and would fail the whole cleanup on a backend that has
		// collected enough rows.
		const verificationsDeleted =
			(await deleteAll((cursor) =>
				ctx.runMutation(components.betterAuth.adapter.deleteMany, {
					input: { model: 'verification', where: [{ field: 'value', value: user._id }] },
					paginationOpts: { numItems: 100, cursor }
				})
			)) +
			(await deleteAll((cursor) =>
				ctx.runMutation(components.betterAuth.adapter.deleteMany, {
					input: { model: 'verification', where: [{ field: 'identifier', value: email }] },
					paginationOpts: { numItems: 100, cursor }
				})
			));

		await deleteAll((cursor) =>
			ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input: { model: 'passkey', where: [{ field: 'userId', value: user._id }] },
				paginationOpts: { numItems: 100, cursor }
			})
		);

		// Delete the user; its trigger also removes the passkey nudge dismissal.
		await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
			input: {
				model: 'user',
				where: [{ field: 'email', value: email }]
			},
			onDeleteHandle
		});

		return {
			success: true,
			deletedEmail: email,
			accountsDeleted,
			sessionsDeleted,
			verificationsDeleted
		};
	}
});

// Deletes the listed E2E notification recipients. Test user accounts stay.
export const cleanupTestData = mutation({
	args: { secret: v.string(), emails: v.optional(v.array(v.string())) },
	returns: v.object({
		success: v.boolean(),
		deletedCount: v.number(),
		message: v.string()
	}),
	handler: async (ctx, { secret, emails = [] }) => {
		requireTestSecret(secret);

		let deletedCount = 0;

		if (emails.some((email) => !email.endsWith('@e2e.example.com'))) {
			throw new Error('Cleanup accepts only exact E2E recipient emails');
		}
		// Each indexed lookup is unique; an omitted ownership list deletes nothing.
		for (const email of new Set(emails)) {
			const pref = await ctx.db
				.query('adminNotificationPreferences')
				.withIndex('by_email', (q) => q.eq('email', email))
				.unique();
			if (pref) {
				await ctx.db.delete('adminNotificationPreferences', pref._id);
				deletedCount++;
			}
		}

		return {
			success: true,
			deletedCount,
			message: `Cleaned up ${deletedCount} test notification recipients`
		};
	}
});

/**
 * A test-only fixture an E2E worker registered in its ownership ledger before
 * seeding it. Every row the seed wrote carries the token, so recovery after a
 * killed worker selects rows by token, never by a user ID alone.
 */
const ownedFixtureValidator = v.union(
	// Audit rows are reached through the `by_admin` index of the fixture's own ID.
	v.object({ kind: v.literal('auditLog'), token: v.string(), fixtureId: v.string() }),
	v.object({ kind: v.literal('aiChatHistory'), token: v.string() }),
	v.object({ kind: v.literal('supportNotification'), token: v.string() })
);
type OwnedFixture = Infer<typeof ownedFixtureValidator>;
type DatabaseReader = Pick<QueryCtx, 'db'>;

// A seed call writes at most 100 rows, and the specs clear a fixture before
// seeding it again, so one bounded read holds every row a token can own.
const OWNED_FIXTURE_ROW_LIMIT = 200;

async function auditFixtureRows(
	ctx: DatabaseReader,
	fixture: Extract<OwnedFixture, { kind: 'auditLog' }>
) {
	const rows = await ctx.db
		.query('adminAuditLogs')
		.withIndex('by_admin', (q) => q.eq('adminUserId', fixture.fixtureId))
		.take(OWNED_FIXTURE_ROW_LIMIT);
	return rows.filter(
		(row) =>
			row.targetUserId === fixture.fixtureId &&
			row.metadata !== undefined &&
			'reason' in row.metadata &&
			row.metadata.reason.startsWith(`${fixture.token}:`)
	);
}

function aiHistoryFixtureRows(ctx: DatabaseReader, token: string) {
	// Every thread ID that starts with `<token>-` sorts before `<token>.`.
	return ctx.db
		.query('aiChatThreads')
		.withIndex('by_thread', (q) => q.gte('threadId', `${token}-`).lt('threadId', `${token}.`))
		.take(OWNED_FIXTURE_ROW_LIMIT);
}

function notificationFixtureRow(ctx: DatabaseReader, token: string) {
	return ctx.db
		.query('pendingAdminNotifications')
		.withIndex('by_thread', (q) => q.eq('threadId', supportRecoveryFixturePrefix + token))
		.unique();
}

/** Deletes every row one registered fixture still holds; global teardown calls it per ledger entry. */
export const deleteOwnedFixture = mutation({
	args: { secret: v.string(), fixture: ownedFixtureValidator },
	returns: v.object({ deleted: v.number() }),
	handler: async (ctx, { secret, fixture }) => {
		requireTestSecret(secret);
		requireFixtureToken(fixture.token);
		switch (fixture.kind) {
			case 'auditLog': {
				const rows = await auditFixtureRows(ctx, fixture);
				for (const row of rows) await ctx.db.delete('adminAuditLogs', row._id);
				return { deleted: rows.length };
			}
			case 'aiChatHistory': {
				const rows = await aiHistoryFixtureRows(ctx, fixture.token);
				for (const row of rows) await ctx.db.delete('aiChatThreads', row._id);
				return { deleted: rows.length };
			}
			case 'supportNotification': {
				const row = await notificationFixtureRow(ctx, fixture.token);
				if (row) await deleteSupportRecoveryFixture(ctx, row);
				return { deleted: row ? 1 : 0 };
			}
		}
	}
});

const ownedTestDataRemains = v.object({
	userEmails: v.array(v.string()),
	recipientEmails: v.array(v.string()),
	supportThreadOwners: v.array(v.string()),
	agentThreadIds: v.array(v.string()),
	fixtureTokens: v.array(v.string())
});

/**
 * Reads back what of an E2E run's ownership ledger still exists. Global
 * teardown keeps the ledger until every list comes back empty. Support data is
 * checked twice: the app's `supportThreads` rows per owner, and the agent
 * component's thread per deleted thread ID, whose deletion
 * `cleanupAnonymousSupportThreads` can only log. Agent threads are checked by
 * ID because AI chat threads share the component and the owner's user ID.
 */
export const findOwnedTestData = query({
	args: {
		secret: v.string(),
		userEmails: v.array(v.string()),
		recipientEmails: v.array(v.string()),
		supportOwners: v.array(v.string()),
		supportThreadIds: v.array(v.string()),
		fixtures: v.array(ownedFixtureValidator)
	},
	returns: ownedTestDataRemains,
	handler: async (ctx, args) => {
		requireTestSecret(args.secret);
		const remaining: Infer<typeof ownedTestDataRemains> = {
			userEmails: [],
			recipientEmails: [],
			supportThreadOwners: [],
			agentThreadIds: [],
			fixtureTokens: []
		};
		// One indexed lookup per ledger entry; a run's ledger lists a few hundred at most.
		for (const email of args.userEmails) {
			const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: 'email', value: email }]
			});
			if (user) remaining.userEmails.push(email);
		}
		for (const email of args.recipientEmails) {
			const recipient = await ctx.db
				.query('adminNotificationPreferences')
				.withIndex('by_email', (q) => q.eq('email', email))
				.first();
			if (recipient) remaining.recipientEmails.push(email);
		}
		for (const owner of args.supportOwners) {
			const thread = await ctx.db
				.query('supportThreads')
				.withIndex('by_user_warm', (q) => q.eq('userId', owner))
				.first();
			if (thread) remaining.supportThreadOwners.push(owner);
		}
		for (const threadId of args.supportThreadIds) {
			const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId });
			if (thread) remaining.agentThreadIds.push(threadId);
		}
		for (const fixture of args.fixtures) {
			requireFixtureToken(fixture.token);
			const left =
				fixture.kind === 'auditLog'
					? (await auditFixtureRows(ctx, fixture)).length > 0
					: fixture.kind === 'aiChatHistory'
						? (await aiHistoryFixtureRows(ctx, fixture.token)).length > 0
						: (await notificationFixtureRow(ctx, fixture.token)) !== null;
			if (left) remaining.fixtureTokens.push(fixture.token);
		}
		return remaining;
	}
});

// Deletes every @e2e.example.com user with its accounts, sessions, and notification
// preferences
export const cleanupAllTestUsers = mutation({
	args: { secret: v.string() },
	returns: v.object({ success: v.boolean(), found: v.number(), deleted: v.number() }),
	handler: async (ctx, { secret }) => {
		requireTestSecret(secret);

		const e2eUsers: Array<{ _id: string; email: string }> = [];
		let cursor: string | null = null;
		let hasMore = true;

		while (hasMore) {
			const result: {
				page: Array<Record<string, unknown>>;
				isDone: boolean;
				continueCursor: string;
			} = await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor, numItems: 200 }
			});
			for (const user of result.page) {
				const u = user as { _id: string; email?: string };
				if (u.email?.endsWith('@e2e.example.com')) {
					e2eUsers.push({ _id: u._id, email: u.email });
				}
			}
			hasMore = !result.isDone;
			cursor = result.continueCursor;
		}

		// Sequential deletes in one-time cleanup (test-only, bounded dataset)
		let deleted = 0;
		for (const user of e2eUsers) {
			await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input: { model: 'account', where: [{ field: 'userId', value: user._id }] },
				paginationOpts: { numItems: 100, cursor: null }
			});
			await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input: { model: 'session', where: [{ field: 'userId', value: user._id }] },
				paginationOpts: { numItems: 100, cursor: null }
			});
			const pref = await ctx.db
				.query('adminNotificationPreferences')
				.withIndex('by_email', (q) => q.eq('email', user.email))
				.first();
			if (pref) await ctx.db.delete('adminNotificationPreferences', pref._id);
			await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
				input: { model: 'user', where: [{ field: 'email', value: user.email }] }
			});
			deleted++;
		}

		// Resync all dashboard counters after bulk deletes (bypasses auth onDelete triggers)
		if (deleted > 0) {
			await recalculateCounters(ctx);
		}

		return { success: true, found: e2eUsers.length, deleted };
	}
});

/**
 * Recalculate dashboard counters from actual user data.
 * Use after bulk operations that bypassed auth triggers.
 */
export const recalculateDashboardCounters = mutation({
	args: { secret: v.string() },
	returns: v.object({
		totalUsers: v.number(),
		adminCount: v.number(),
		bannedCount: v.number()
	}),
	handler: async (ctx, { secret }) => {
		requireTestSecret(secret);
		return await recalculateCounters(ctx);
	}
});
