import { mutation, query, internalMutation, internalQuery } from '../../convex/_generated/server';
import { v } from 'convex/values';
import { supportAgent } from './agent';
import { components, internal } from '../../convex/_generated/api';
import { paginationOptsValidator } from 'convex/server';
import { t, extractLocaleFromUrl } from '../i18n/translations';
import {
	requireSupportThreadAccess,
	requireSupportThreadRecord,
	getSupportOwnerIdentity,
	requireSupportOwnerIdentity
} from './ownership';
import {
	createSupportThreadRecord,
	limitSupportThreadCreate,
	recordFirstSupportContact,
	syncSupportLastMessage
} from './threadLifecycle';
import {
	backfillThreadMetadata as backfillThreadMetadataRecord,
	deleteEmptyThreads as deleteEmptyThreadRecords,
	sweepEmptyThread as sweepEmptyThreadRecord,
	getThreadLocale as getSupportThreadLocale,
	syncUserProfile as syncSupportUserProfile,
	updateThreadMetadata as updateSupportThreadMetadata
} from './threadMaintenance';
import { normalizeNotificationEmail } from './notificationPreferences';
import { toAgentThreadStatus } from './denormalization';
import { authComponent } from '../authServer';
import { publicEndpoint } from '../access';
import { normalizeSupportPageRoute } from '../../shared/support-page-route';
import { recordSupportMessageContext } from './messageContext';

export { shouldSendNotification } from './notificationPreferences';
export { syncSupportLastMessage } from './threadLifecycle';

// supportThreads is the source of truth for membership and list rendering.
// agent:threads owns only generic conversation runtime/storage.

/**
 * Creates a support thread. A user may hold several.
 *
 * Agent threads carry no custom metadata, so a separate supportThreads record
 * stores the admin-side data.
 */
export const createThread = mutation({
	args: {
		anonymousUserId: v.optional(v.string()),
		title: v.optional(v.string()),
		pageUrl: v.optional(v.string())
	},
	returns: v.object({
		threadId: v.string(),
		notificationEmail: v.optional(v.string())
	}),
	handler: async (ctx, args) => {
		const owner = await requireSupportOwnerIdentity(ctx, args.anonymousUserId);
		await limitSupportThreadCreate(ctx, owner);
		return await createSupportThreadRecord(ctx, {
			resolvedUserId: owner.ownerId,
			isAnonymous: owner.isAnonymous,
			title: args.title || 'Customer Support',
			summary: 'New support conversation',
			pageUrl: args.pageUrl,
			awaitingAdminResponse: true
		});
	}
});

/**
 * Get or create a reusable empty support thread for the current support owner.
 *
 * Uses the same owner identity as support access: authenticated user ID when
 * available, otherwise the validated anonymous `anon_*` ID.
 */
export const getOrCreateWarmThread = mutation({
	args: {
		anonymousUserId: v.optional(v.string()),
		pageUrl: v.optional(v.string())
	},
	returns: v.object({
		threadId: v.string(),
		notificationEmail: v.optional(v.string())
	}),
	handler: async (ctx, args) => {
		const pageUrl = normalizeSupportPageRoute(args.pageUrl);
		const owner = await requireSupportOwnerIdentity(ctx, args.anonymousUserId);

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

		// Only the creation branch consumes a token; the idempotent read above doesn't
		await limitSupportThreadCreate(ctx, owner);

		return await createSupportThreadRecord(ctx, {
			resolvedUserId: owner.ownerId,
			isAnonymous: owner.isAnonymous,
			title: 'Customer Support',
			summary: 'New support conversation',
			pageUrl,
			isWarm: true,
			awaitingAdminResponse: false
		});
	}
});

/**
 * Lists the caller's threads, most recent message first.
 *
 * @security Authenticated callers use server-verified identity.
 *           Anonymous callers must present the same anon_* proof used to create the thread.
 */
export const listThreads = query({
	args: {
		anonymousUserId: v.optional(v.string()),
		paginationOpts: v.optional(paginationOptsValidator)
	},
	returns: v.object({
		page: v.array(
			v.object({
				_id: v.string(),
				_creationTime: v.number(),
				userId: v.string(),
				title: v.optional(v.string()),
				summary: v.optional(v.string()),
				status: v.union(v.literal('active'), v.literal('archived')),
				lastAgentName: v.optional(v.string()),
				lastMessageRole: v.optional(
					v.union(v.literal('user'), v.literal('assistant'), v.literal('tool'), v.literal('system'))
				),
				lastMessage: v.optional(v.string()),
				lastMessageAt: v.optional(v.number()),
				isHandedOff: v.boolean(),
				hasUnreadAdminReply: v.boolean(),
				notificationEmail: v.optional(v.string()),
				assignedAdmin: v.optional(
					v.object({
						name: v.optional(v.string()),
						image: v.union(v.string(), v.null())
					})
				)
			})
		),
		isDone: v.boolean(),
		continueCursor: v.string()
	}),
	handler: async (ctx, args) => {
		publicEndpoint(
			'Anonymous visitors list their own threads; reads stay within the resolved owner.'
		);
		const owner = await getSupportOwnerIdentity(ctx, args.anonymousUserId);
		if (!owner) {
			return { page: [], isDone: true, continueCursor: '' };
		}

		const supportThreadsPage = await ctx.db
			.query('supportThreads')
			.withIndex('by_user_and_last_message', (q) => q.eq('userId', owner.ownerId))
			.order('desc')
			.paginate(args.paginationOpts ?? { numItems: 20, cursor: null });
		// Bounded: each owner has at most one pre-warmed thread.
		const supportThreads = supportThreadsPage.page.filter((supportThread) => !supportThread.isWarm);

		const adminIds = new Set<string>();
		for (const supportThread of supportThreads) {
			if (supportThread.assignedTo) adminIds.add(supportThread.assignedTo);
		}

		const adminMap = new Map<string, { name?: string; image: string | null }>();
		if (adminIds.size > 0) {
			try {
				// `_id in` returns every matching point read; missing users are omitted.
				const admins = await ctx.runQuery(components.betterAuth.adapter.findMany, {
					model: 'user',
					where: [{ field: '_id', operator: 'in', value: [...adminIds] }],
					paginationOpts: { cursor: null, numItems: adminIds.size },
					select: ['_id', 'name', 'image']
				});
				for (const admin of admins.page as Array<{
					_id: string;
					name?: string;
					image?: string | null;
				}>) {
					adminMap.set(admin._id, { name: admin.name, image: admin.image ?? null });
				}
			} catch {
				// Preserve per-assignment failure isolation for malformed legacy IDs.
				await Promise.all(
					[...adminIds].map(async (adminId) => {
						try {
							const admin = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
								model: 'user',
								where: [{ field: '_id', operator: 'eq', value: adminId }],
								select: ['name', 'image']
							})) as { name?: string; image?: string | null } | null;
							if (admin) {
								adminMap.set(adminId, { name: admin.name, image: admin.image ?? null });
							}
						} catch {
							console.log({ code: 'support_admin_unavailable', adminId });
						}
					})
				);
			}
		}

		const threads = supportThreads.map((supportThread) => {
			const assignedAdmin = supportThread.assignedTo
				? adminMap.get(supportThread.assignedTo)
				: undefined;

			return {
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
				assignedAdmin
			};
		});

		return {
			page: threads,
			isDone: supportThreadsPage.isDone,
			continueCursor: supportThreadsPage.continueCursor
		};
	}
});

/**
 * Returns one thread of the caller. `isHandedOff` tells the widget whether to
 * offer the handoff button.
 *
 * @security Users read only their own threads. Authenticated users are matched
 *           by server-verified ID, anonymous users by their client ID.
 */
export const getThread = query({
	args: {
		threadId: v.string(),
		anonymousUserId: v.optional(v.string())
	},
	returns: v.object({
		_id: v.string(),
		_creationTime: v.number(),
		userId: v.optional(v.string()),
		title: v.optional(v.string()),
		summary: v.optional(v.string()),
		status: v.union(v.literal('active'), v.literal('archived')),
		isHandedOff: v.boolean(),
		lastAdminReplyAt: v.optional(v.number()),
		lastAdminReplyMessageId: v.optional(v.string()),
		userReadAt: v.optional(v.number()),
		hasUnreadAdminReply: v.boolean(),
		notificationEmail: v.optional(v.string()),
		assignedAdmin: v.optional(
			v.object({
				name: v.optional(v.string()),
				image: v.union(v.string(), v.null())
			})
		)
	}),
	handler: async (ctx, args) => {
		const { supportThread, thread } = await requireSupportThreadAccess(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});

		let assignedAdmin: { name?: string; image: string | null } | undefined;
		if (supportThread?.assignedTo) {
			try {
				const admin = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
					model: 'user',
					where: [{ field: '_id', operator: 'eq', value: supportThread.assignedTo }],
					select: ['name', 'image']
				})) as { name?: string; image?: string | null } | null;
				if (admin) {
					assignedAdmin = {
						name: admin.name,
						image: admin.image ?? null
					};
				}
			} catch {
				console.log({ code: 'support_admin_unavailable', adminId: supportThread.assignedTo });
			}
		}

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
	}
});

/**
 * Hands a thread to human support at the visitor's request.
 *
 * The handoff is permanent: the agent never answers in this thread again.
 */
export const updateThreadHandoff = mutation({
	args: {
		threadId: v.string(),
		anonymousUserId: v.optional(v.string()),
		// Optional so clients that predate per-message routes stay valid.
		pageUrl: v.optional(v.string()),
		// The build the sender's tab runs. Clients that predate it omit it.
		appVersion: v.optional(v.string())
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const { supportThread } = await requireSupportThreadRecord(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});

		if (supportThread.isHandedOff) {
			return true;
		}

		const { messageId } = await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'user',
				content: 'Talk to support'
			},
			skipEmbeddings: true
		});

		// The request names the page and build it was made from, like any other message.
		await recordSupportMessageContext(ctx, {
			threadId: args.threadId,
			messageId,
			pageUrl: args.pageUrl,
			appVersion: args.appVersion
		});

		// The acknowledgement carries the email prompt, in the locale of the page
		// where the chat started
		const locale = extractLocaleFromUrl(supportThread.pageUrl);
		await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'assistant',
				content: t(locale, 'backend.support.handoff.response')
			},
			skipEmbeddings: true
		});

		// The request is the owner's own message, so a pre-warmed thread stops being
		// an empty placeholder here, exactly as on an ordinary first message.
		// Otherwise anonymous-ticket migration would delete it as unused.
		const now = Date.now();
		await ctx.db.patch('supportThreads', supportThread._id, {
			isWarm: false,
			isHandedOff: true,
			awaitingAdminResponse: true,
			updatedAt: now
		});
		await recordFirstSupportContact(ctx, supportThread, now);

		await syncSupportLastMessage(ctx, args.threadId);

		const recentMessageIds = await ctx.runQuery(
			internal.admin.support.notifications.getRecentUserMessages,
			{ threadId: args.threadId }
		);

		// A handoff always notifies admins, even with no prior user messages (a bare
		// "Talk to support" with nothing typed before it). Downstream the email
		// renders a no-messages fallback line instead of message excerpts.
		await ctx.scheduler.runAfter(
			0,
			internal.admin.support.notifications.scheduleAdminNotification,
			{
				threadId: args.threadId,
				messageIds: recentMessageIds,
				isReopen: false,
				notificationType: 'newTickets'
			}
		);

		return true;
	}
});

/**
 * Returns admin names and avatars for the support widget.
 *
 * @security Public by design. The widget shows the team before a visitor starts a
 * conversation. Only names and profile images leave the server, no emails or IDs.
 * To hide admin identities, require authentication, drop the names, or return
 * placeholder avatars.
 */
export const getAdminAvatars = query({
	args: {},
	returns: v.array(
		v.object({
			name: v.optional(v.string()),
			image: v.union(v.string(), v.null())
		})
	),
	handler: async (ctx) => {
		publicEndpoint('The support widget shows admin names and avatars to every visitor.');
		const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor: null, numItems: 100 },
			where: [{ field: 'role', operator: 'eq', value: 'admin' }],
			select: ['name', 'image']
		});

		const admins = result.page as Array<{
			name?: string;
			image?: string | null;
		}>;

		return admins.map((admin) => ({
			name: admin.name,
			image: admin.image ?? null
		}));
	}
});

/**
 * Opts the thread owner in to an email when an admin replies.
 *
 * @security Only the thread owner can set the address.
 */
export const updateNotificationEmail = mutation({
	args: {
		threadId: v.string(),
		email: v.string(),
		anonymousUserId: v.optional(v.string())
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const { supportThread } = await requireSupportThreadRecord(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});

		await ctx.db.patch('supportThreads', supportThread._id, {
			notificationEmail: normalizeNotificationEmail(args.email),
			updatedAt: Date.now()
		});

		return true;
	}
});

/** Copies a thread's title and summary into the denormalized search fields. */
export const updateThreadMetadata = internalMutation({
	args: {
		threadId: v.string(),
		title: v.optional(v.string()),
		summary: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await updateSupportThreadMetadata(ctx, args);
		return null;
	}
});

/**
 * Copies the last message into the denormalized search fields after a user or
 * admin message.
 *
 * Action-context callers use this function path. Mutation-context callers call
 * syncSupportLastMessage directly.
 */
export const updateLastMessage = internalMutation({
	args: {
		threadId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await syncSupportLastMessage(ctx, args.threadId);
		return null;
	}
});

/**
 * Sync denormalized user profile fields across all of a user's support threads.
 * Called from the Better Auth onUpdate trigger when name or email changes.
 *
 * Leaves notificationEmail untouched (explicit opt-in that may intentionally
 * differ from the account email) and does not bump updatedAt (a profile edit
 * is not thread activity and must not reorder the admin inbox).
 *
 * The first page runs inside the trigger; later pages are scheduled, so a user
 * with more threads than one page briefly shows the old profile on the rest.
 */
export const syncUserProfile = internalMutation({
	args: {
		userId: v.string(),
		userName: v.optional(v.string()),
		userEmail: v.optional(v.string()),
		cursor: v.optional(v.string()),
		endCursor: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (args.cursor !== undefined || args.endCursor !== undefined) {
			// A later profile change restarts from the first page, so a continuation
			// carrying an older name or email stops instead of overwriting it.
			const user = await authComponent.getAnyUserById(ctx, args.userId);
			if (!user || (user.name ?? undefined) !== args.userName || user.email !== args.userEmail) {
				return null;
			}
		}

		const { next } = await syncSupportUserProfile(ctx, args);
		for (const range of next) {
			await ctx.scheduler.runAfter(0, internal.support.threads.syncUserProfile, {
				userId: args.userId,
				userName: args.userName,
				userEmail: args.userEmail,
				...range
			});
		}
		return null;
	}
});

/**
 * Backfills the denormalized support fields from supportThreads and agent data.
 * Run it manually before removing any compatibility code.
 */
export const backfillThreadMetadata = internalMutation({
	args: {},
	returns: v.object({ updated: v.number(), total: v.number() }),
	handler: async (ctx) => await backfillThreadMetadataRecord(ctx)
});

/** Returns the locale of a thread's pageUrl, for actions that write localized messages. */
export const getThreadLocale = internalQuery({
	args: {
		threadId: v.string()
	},
	returns: v.string(),
	handler: async (ctx, args) => await getSupportThreadLocale(ctx, args.threadId)
});

/**
 * Cron entry that deletes pre-created threads still without a message after 24
 * hours. Each run schedules one check per candidate.
 *
 * @see src/lib/confect/crons.ts
 */
export const deleteEmptyThreads = internalMutation({
	args: {},
	returns: v.object({ scheduled: v.number(), released: v.number() }),
	handler: async (ctx) => await deleteEmptyThreadRecords(ctx)
});

/** Checks one thread the empty-thread sweep claimed, first check or retry. */
export const sweepEmptyThread = internalMutation({
	args: { supportThreadId: v.id('supportThreads') },
	returns: v.null(),
	handler: async (ctx, args) => {
		await sweepEmptyThreadRecord(ctx, args);
		return null;
	}
});
