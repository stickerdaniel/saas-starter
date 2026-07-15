import { mutation, query, internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import { supportAgent } from './agent';
import { components, internal } from '../_generated/api';
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
	syncSupportLastMessage
} from './threadLifecycle';
import {
	backfillThreadMetadata as backfillThreadMetadataRecord,
	deleteEmptyThreads as deleteEmptyThreadRecords,
	getThreadLocale as getSupportThreadLocale,
	syncUserProfile as syncSupportUserProfile,
	updateThreadMetadata as updateSupportThreadMetadata
} from './threadMaintenance';
import { normalizeNotificationEmail } from './notificationPreferences';
import { toAgentThreadStatus } from './denormalization';

export { shouldSendNotification } from './notificationPreferences';
export { syncSupportLastMessage } from './threadLifecycle';

// supportThreads is the source of truth for membership and list rendering.
// agent:threads owns only generic conversation runtime/storage.

/**
 * Create a new support thread
 *
 * Creates a conversation thread for customer support.
 * Each user can have multiple threads for different support topics.
 *
 * IMPORTANT: Agent threads don't support custom metadata, so we create
 * a separate supportThreads record to store admin-specific data.
 */
export const createThread = mutation({
	args: {
		anonymousUserId: v.optional(v.string()),
		title: v.optional(v.string()),
		pageUrl: v.optional(v.string()) // URL of the page where user started the chat
	},
	returns: v.object({
		threadId: v.string(),
		notificationEmail: v.optional(v.string())
	}),
	handler: async (ctx, args) => {
		const owner = await requireSupportOwnerIdentity(ctx, args.anonymousUserId);
		await limitSupportThreadCreate(ctx, owner, args.pageUrl);
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
		const owner = await requireSupportOwnerIdentity(ctx, args.anonymousUserId);

		const existingWarm = await ctx.db
			.query('supportThreads')
			.withIndex('by_user_warm', (q) => q.eq('userId', owner.ownerId).eq('isWarm', true))
			.first();

		if (existingWarm) {
			if (args.pageUrl && existingWarm.pageUrl !== args.pageUrl) {
				await ctx.db.patch(existingWarm._id, {
					pageUrl: args.pageUrl,
					updatedAt: Date.now()
				});
			}

			return {
				threadId: existingWarm.threadId,
				notificationEmail: existingWarm.notificationEmail
			};
		}

		// Only the creation branch consumes a token; the idempotent read above doesn't
		await limitSupportThreadCreate(ctx, owner, args.pageUrl);

		return await createSupportThreadRecord(ctx, {
			resolvedUserId: owner.ownerId,
			isAnonymous: owner.isAnonymous,
			title: 'Customer Support',
			summary: 'New support conversation',
			pageUrl: args.pageUrl,
			isWarm: true,
			awaitingAdminResponse: false
		});
	}
});

/**
 * List all threads for a user
 *
 * Returns paginated threads with last message preview and metadata.
 * Threads are ordered by most recent activity (last message time).
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
		const owner = await getSupportOwnerIdentity(ctx, args.anonymousUserId);
		if (!owner) {
			// No valid user ID - return empty results
			return { page: [], isDone: true, continueCursor: '' };
		}

		const supportThreadsPage = await ctx.db
			.query('supportThreads')
			.withIndex('by_user_and_updated', (q) => q.eq('userId', owner.ownerId))
			.order('desc')
			.paginate(args.paginationOpts ?? { numItems: 20, cursor: null });
		// Bounded: each owner has at most one pre-warmed thread.
		const supportThreads = supportThreadsPage.page.filter((supportThread) => !supportThread.isWarm);

		// Collect unique admin IDs and fetch their info
		const adminIds = new Set<string>();
		for (const supportThread of supportThreads) {
			if (supportThread.assignedTo) adminIds.add(supportThread.assignedTo);
		}

		const adminMap = new Map<string, { name?: string; image: string | null }>();
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
				} catch (error) {
					console.log(`[listThreads] Failed to fetch admin ${adminId}:`, error);
				}
			})
		);

		const threadsWithLastMessage = supportThreads.map((supportThread) => {
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
				notificationEmail: supportThread.notificationEmail,
				assignedAdmin
			};
		});

		// Sort by lastMessageAt in descending order (most recent first)
		threadsWithLastMessage.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

		return {
			page: threadsWithLastMessage,
			isDone: supportThreadsPage.isDone,
			continueCursor: supportThreadsPage.continueCursor
		};
	}
});

/**
 * Get a specific thread
 *
 * Retrieves thread metadata including title, summary, and creation time.
 * Also returns isHandedOff status for the frontend to show/hide handoff button.
 *
 * @security Verifies ownership - users can only access their own threads.
 *           Authenticated users use server-verified ID, anonymous users use client ID.
 */
export const getThread = query({
	args: {
		threadId: v.string(),
		anonymousUserId: v.optional(v.string()) // For anonymous users
	},
	returns: v.object({
		_id: v.string(),
		_creationTime: v.number(),
		userId: v.optional(v.string()),
		title: v.optional(v.string()),
		summary: v.optional(v.string()),
		status: v.union(v.literal('active'), v.literal('archived')),
		isHandedOff: v.boolean(),
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

		// Fetch assigned admin info if thread is assigned
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
			} catch (error) {
				console.log(`[getThread] Failed to fetch admin ${supportThread.assignedTo}:`, error);
			}
		}

		return {
			...thread,
			status: toAgentThreadStatus(supportThread.status),
			isHandedOff: supportThread?.isHandedOff ?? false,
			notificationEmail: supportThread?.notificationEmail,
			assignedAdmin
		};
	}
});

/**
 * Request handoff to human support
 *
 * User-initiated action to transfer the conversation to human support.
 * Once handed off, AI will never respond in this thread again.
 * This action is permanent and cannot be reversed.
 */
export const updateThreadHandoff = mutation({
	args: {
		threadId: v.string(),
		anonymousUserId: v.optional(v.string()) // For anonymous users
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const { supportThread } = await requireSupportThreadRecord(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});

		// Already handed off - no action needed
		if (supportThread.isHandedOff) {
			return true;
		}

		// Save user message: "Talk to support"
		await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'user',
				content: 'Talk to support'
			},
			skipEmbeddings: true
		});

		// Save assistant response with email prompt
		// Extract locale from the page URL where the user started the chat
		const locale = extractLocaleFromUrl(supportThread.pageUrl);
		await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'assistant',
				content: t(locale, 'backend.support.handoff.response')
			},
			skipEmbeddings: true
		});

		// Mark as handed off - user is waiting for admin response
		await ctx.db.patch(supportThread._id, {
			isHandedOff: true,
			awaitingAdminResponse: true,
			updatedAt: Date.now()
		});

		// Sync last message for search
		await syncSupportLastMessage(ctx, args.threadId);

		// Get recent user messages and schedule admin notification immediately
		// This starts the 2-minute debounce as soon as "Talk to human" is pressed
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
				notificationType: 'newTickets' // Handoff from AI to human
			}
		);

		return true;
	}
});

/**
 * Get admin user avatars for display in support widget
 *
 * Returns public profile information (name and avatar) for admin users.
 *
 * @security INTENTIONALLY PUBLIC - Security Decision Documentation
 *
 * This query is intentionally unauthenticated because:
 * 1. Purpose: Displays friendly admin avatars in the customer support widget
 *    to build trust before users start a conversation
 * 2. Data exposed: Only names and profile images - no emails, IDs, or sensitive data
 * 3. Risk assessment: LOW - This information is typically public on company
 *    "About Us" or "Team" pages anyway
 * 4. Trade-off: Better UX (welcoming support widget) vs minor info disclosure
 *
 * If you need to hide admin identities:
 * - Convert to authedQuery() to require authentication
 * - Or return only images without names
 * - Or use generic placeholder avatars
 *
 * Reviewed: 2024-12 | Decision: Acceptable for current use case
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
		// Fetch all users with admin role
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

		// Return only name and image (public profile data)
		return admins.map((admin) => ({
			name: admin.name,
			image: admin.image ?? null
		}));
	}
});

/**
 * Set notification email for a support thread
 *
 * Allows users to opt-in to email notifications when an admin responds.
 * Email is normalized (lowercase, trimmed) before saving.
 *
 * @security Verifies thread ownership before allowing email to be set.
 */
export const updateNotificationEmail = mutation({
	args: {
		threadId: v.string(),
		email: v.string(),
		anonymousUserId: v.optional(v.string()) // For anonymous users
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const { supportThread } = await requireSupportThreadRecord(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});

		await ctx.db.patch(supportThread._id, {
			notificationEmail: normalizeNotificationEmail(args.email),
			updatedAt: Date.now()
		});

		return true;
	}
});

// ============================================================================
// Internal Sync Mutations (for keeping denormalized search fields in sync)
// ============================================================================

/**
 * Sync thread metadata (title/summary) to denormalized search fields.
 * Called when thread metadata is updated.
 */
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
 * Sync last message to denormalized search fields.
 * Called after a message is sent (user or admin).
 *
 * Mutation-context callers import the lifecycle helper directly; this facade
 * preserves the existing Convex function path for action-context callers.
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
 * is not thread activity and must not reorder by_user_and_updated listings).
 */
export const syncUserProfile = internalMutation({
	args: {
		userId: v.string(),
		userName: v.optional(v.string()),
		userEmail: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await syncSupportUserProfile(ctx, args);
		return null;
	}
});

/**
 * Backfill support denormalized fields from existing supportThreads + agent data.
 * Run manually before removing any historical compatibility code.
 */
export const backfillThreadMetadata = internalMutation({
	args: {},
	returns: v.object({ updated: v.number(), total: v.number() }),
	handler: async (ctx) => await backfillThreadMetadataRecord(ctx)
});

/**
 * Internal query to get thread locale from pageUrl
 *
 * Used by internal actions that need to return localized messages.
 */
export const getThreadLocale = internalQuery({
	args: {
		threadId: v.string()
	},
	returns: v.string(),
	handler: async (ctx, args) => await getSupportThreadLocale(ctx, args.threadId)
});

/**
 * Internal mutation to delete empty threads (no messages after 24h)
 *
 * Called by cron job to clean up threads created during eager thread creation
 * where the user never sent a message.
 *
 * @see src/lib/convex/crons.ts
 */
export const deleteEmptyThreads = internalMutation({
	args: {},
	returns: v.object({ deleted: v.number() }),
	handler: async (ctx) => await deleteEmptyThreadRecords(ctx)
});
