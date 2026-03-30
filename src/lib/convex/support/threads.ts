import {
	mutation,
	query,
	internalMutation,
	internalQuery,
	type QueryCtx,
	type MutationCtx
} from '../_generated/server';
import { v, ConvexError } from 'convex/values';
import * as val from 'valibot';
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
	buildSupportMessageDenormalization,
	buildSupportSearchText,
	type SupportLatestThreadMessage
} from './denormalization';

// supportThreads is the source of truth for support thread membership and list rendering.
// agent:threads remains shared runtime/storage used only for generic conversation metadata.

async function getLatestCompletedThreadMessage(
	ctx: QueryCtx,
	threadId: string
): Promise<SupportLatestThreadMessage | undefined> {
	const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
		threadId,
		order: 'desc',
		statuses: ['success'],
		excludeToolMessages: true,
		paginationOpts: { numItems: 1, cursor: null }
	});

	return messages.page[0] as SupportLatestThreadMessage | undefined;
}

async function getSupportOwnerProfile(
	ctx: QueryCtx | MutationCtx,
	resolvedUserId: string,
	isAnonymous: boolean
) {
	if (isAnonymous) {
		return { userName: undefined, userEmail: undefined };
	}

	try {
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: resolvedUserId }]
		});
		if (user) {
			return {
				userName: user.name,
				userEmail: user.email
			};
		}
	} catch (error) {
		console.log(`[supportThreads] Failed to fetch user ${resolvedUserId}:`, error);
	}

	return { userName: undefined, userEmail: undefined };
}

async function createSupportThreadRecord(
	ctx: MutationCtx,
	args: {
		resolvedUserId: string;
		isAnonymous: boolean;
		title: string;
		summary: string;
		pageUrl?: string;
		isWarm?: boolean;
		awaitingAdminResponse: boolean;
	}
) {
	const { threadId } = await supportAgent.createThread(ctx, {
		userId: args.resolvedUserId,
		title: args.title,
		summary: args.summary
	});

	const { userName, userEmail } = await getSupportOwnerProfile(
		ctx,
		args.resolvedUserId,
		args.isAnonymous
	);
	const searchText = buildSupportSearchText({
		title: args.title,
		summary: args.summary,
		userName,
		userEmail
	});
	const now = Date.now();

	await ctx.db.insert('supportThreads', {
		threadId,
		userId: args.resolvedUserId,
		isWarm: args.isWarm,
		status: 'open',
		isHandedOff: false,
		awaitingAdminResponse: args.awaitingAdminResponse,
		assignedTo: undefined,
		priority: undefined,
		pageUrl: args.pageUrl || undefined,
		createdAt: now,
		updatedAt: now,
		notificationEmail: userEmail,
		searchText,
		title: args.title,
		summary: args.summary,
		lastMessage: undefined,
		lastMessageAt: undefined,
		lastMessageRole: undefined,
		lastAgentName: undefined,
		userName,
		userEmail
	});

	return { threadId, notificationEmail: userEmail };
}

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
				userId: v.optional(v.string()),
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
		const supportThreads = supportThreadsPage.page.filter((supportThread) => !supportThread.isWarm);

		// Collect unique admin IDs and fetch their info
		const adminIds = new Set<string>();
		for (const supportThread of supportThreads) {
			if (supportThread.assignedTo) adminIds.add(supportThread.assignedTo);
		}

		const adminMap = new Map<string, { name?: string; image: string | null }>();
		for (const adminId of adminIds) {
			try {
				const admin = await ctx.runQuery(components.betterAuth.adapter.findOne, {
					model: 'user',
					where: [{ field: '_id', operator: 'eq', value: adminId }]
				});
				if (admin) {
					adminMap.set(adminId, { name: admin.name, image: admin.image ?? null });
				}
			} catch (error) {
				console.log(`[listThreads] Failed to fetch admin ${adminId}:`, error);
			}
		}

		// For each thread, get the last message and combine with support data
		const threadsWithLastMessage = await Promise.all(
			supportThreads.map(async (supportThread) => {
				let thread;
				try {
					thread = await ctx.runQuery(components.agent.threads.getThread, {
						threadId: supportThread.threadId
					});
				} catch (error) {
					console.log(
						`[listThreads] Failed to fetch agent thread ${supportThread.threadId}:`,
						error
					);
					return null;
				}

				if (!thread) {
					return null;
				}

				const assignedAdmin = supportThread.assignedTo
					? adminMap.get(supportThread.assignedTo)
					: undefined;

				return {
					_id: supportThread.threadId,
					_creationTime: supportThread.createdAt,
					userId: supportThread.userId ?? thread.userId,
					title: supportThread.title,
					summary: supportThread.summary,
					status: thread.status,
					lastAgentName: supportThread.lastAgentName,
					lastMessageRole: supportThread.lastMessageRole,
					lastMessage: supportThread.lastMessage,
					lastMessageAt: supportThread.lastMessageAt,
					isHandedOff: supportThread.isHandedOff ?? false,
					notificationEmail: supportThread.notificationEmail,
					assignedAdmin
				};
			})
		);

		// Sort by lastMessageAt in descending order (most recent first)
		const validThreads = threadsWithLastMessage.filter(
			(thread): thread is NonNullable<(typeof threadsWithLastMessage)[number]> => thread !== null
		);
		validThreads.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

		return {
			page: validThreads,
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
				const admin = await ctx.runQuery(components.betterAuth.adapter.findOne, {
					model: 'user',
					where: [{ field: '_id', operator: 'eq', value: supportThread.assignedTo }]
				});
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
		await ctx.runMutation(internal.support.threads.updateLastMessage, {
			threadId: args.threadId
		});

		// Get recent user messages and schedule admin notification immediately
		// This starts the 2-minute debounce as soon as "Talk to human" is pressed
		const recentMessageIds = await ctx.runQuery(
			internal.admin.support.notifications.getRecentUserMessages,
			{ threadId: args.threadId }
		);

		if (recentMessageIds.length > 0) {
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
		}

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
			where: [{ field: 'role', operator: 'eq', value: 'admin' }]
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

// ============================================================================
// Email Notification Helpers
// ============================================================================

const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Check if a notification should be sent based on cooldown period.
 * Returns true if:
 * - notificationEmail is set AND
 * - Either no notification has been sent yet OR 30+ minutes have passed
 */
export function shouldSendNotification(
	notificationEmail: string | undefined,
	notificationSentAt: number | undefined
): boolean {
	if (!notificationEmail) return false;
	if (!notificationSentAt) return true; // First notification
	return Date.now() - notificationSentAt >= NOTIFICATION_COOLDOWN_MS;
}

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
		// Normalize email (empty string = unsubscribe)
		const normalizedEmail = args.email.trim().toLowerCase();

		// Validate email format only if non-empty (empty = unsubscribe)
		if (
			normalizedEmail &&
			!val.safeParse(val.pipe(val.string(), val.email()), normalizedEmail).success
		) {
			throw new ConvexError('Invalid email format');
		}

		const { supportThread } = await requireSupportThreadRecord(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});

		// Update notification email (undefined to unsubscribe)
		await ctx.db.patch(supportThread._id, {
			notificationEmail: normalizedEmail || undefined,
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
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			console.log(`[syncThreadMetadata] No supportThread found for: ${args.threadId}`);
			return;
		}

		// Merge new values with existing
		const title = args.title ?? supportThread.title;
		const summary = args.summary ?? supportThread.summary;

		// Rebuild searchText
		const searchText = buildSupportSearchText({
			title,
			summary,
			lastMessage: supportThread.lastMessage,
			userName: supportThread.userName,
			userEmail: supportThread.userEmail
		});

		await ctx.db.patch(supportThread._id, {
			title,
			summary,
			searchText,
			updatedAt: Date.now()
		});
	}
});

/**
 * Sync last message to denormalized search fields.
 * Called after a message is sent (user or admin).
 */
export const updateLastMessage = internalMutation({
	args: {
		threadId: v.string()
	},
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			console.log(`[syncLastMessage] No supportThread found for: ${args.threadId}`);
			return;
		}

		const latestMessage = await getLatestCompletedThreadMessage(ctx, args.threadId);
		const patch = buildSupportMessageDenormalization({
			title: supportThread.title,
			summary: supportThread.summary,
			userName: supportThread.userName,
			userEmail: supportThread.userEmail,
			latestMessage
		});

		await ctx.db.patch(supportThread._id, {
			...patch,
			updatedAt: Date.now()
		});
	}
});

/**
 * Backfill support denormalized fields from existing supportThreads + agent data.
 * Run manually before removing any historical compatibility code.
 */
export const backfillThreadMetadata = internalMutation({
	args: {},
	returns: v.object({ updated: v.number(), total: v.number() }),
	handler: async (ctx) => {
		// One-time backfill for pre-release data; supportThreads volume is bounded in this repo.
		const supportThreads = await ctx.db.query('supportThreads').collect();
		let updated = 0;

		for (const supportThread of supportThreads) {
			let agentThread;
			try {
				agentThread = await ctx.runQuery(components.agent.threads.getThread, {
					threadId: supportThread.threadId
				});
			} catch {
				continue;
			}

			if (!agentThread) continue;

			const patch = {
				title: agentThread.title,
				summary: agentThread.summary,
				...buildSupportMessageDenormalization({
					title: agentThread.title,
					summary: agentThread.summary,
					userName: supportThread.userName,
					userEmail: supportThread.userEmail,
					latestMessage: await getLatestCompletedThreadMessage(ctx, supportThread.threadId)
				})
			};

			await ctx.db.patch(supportThread._id, patch);
			updated++;
		}

		return { updated, total: supportThreads.length };
	}
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
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		return extractLocaleFromUrl(supportThread?.pageUrl);
	}
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
	handler: async (ctx) => {
		const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

		// Find threads older than 24h
		const oldThreads = await ctx.db
			.query('supportThreads')
			.withIndex('by_creation_time')
			.filter((q) => q.lt(q.field('_creationTime'), cutoffTime))
			.take(100); // Batch to avoid timeout

		let deletedCount = 0;

		for (const supportThread of oldThreads) {
			// Check if thread has any messages using agent's message API
			const result = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
				threadId: supportThread.threadId,
				order: 'asc',
				paginationOpts: { numItems: 1, cursor: null }
			});

			if (result.page.length > 0) {
				// Thread has messages - skip
				continue;
			}

			// Delete agent thread first
			try {
				await supportAgent.deleteThreadAsync(ctx, { threadId: supportThread.threadId });
			} catch (error) {
				console.log(`[deleteEmptyThreads] Failed to delete agent thread: ${String(error)}`);
				continue; // Skip supportThread deletion - retry next cron run
			}

			// Delete supportThread record
			await ctx.db.delete(supportThread._id);
			deletedCount++;
		}

		if (deletedCount > 0) {
			console.log(`[deleteEmptyThreads] Deleted ${deletedCount} empty threads`);
		}

		return { deleted: deletedCount };
	}
});
