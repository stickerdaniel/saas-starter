import { mutation, query, internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { supportAgent } from './agent';
import { components, internal } from '../_generated/api';
import { paginationOptsValidator } from 'convex/server';
import { isAnonymousUser } from '../utils/anonymousUser';
import { authComponent } from '../auth';

/**
 * Helper to build searchText from denormalized fields.
 * Combines all searchable fields into a single lowercase string.
 */
function buildSearchText(fields: {
	title?: string;
	summary?: string;
	lastMessage?: string;
	userName?: string;
	userEmail?: string;
}): string {
	return (
		[fields.title, fields.summary, fields.lastMessage, fields.userName, fields.userEmail]
			.filter(Boolean)
			.join(' | ')
			.toLowerCase() || 'untitled'
	);
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
		userId: v.optional(v.string()),
		title: v.optional(v.string()),
		pageUrl: v.optional(v.string()) // URL of the page where user started the chat
	},
	returns: v.object({
		threadId: v.string(),
		notificationEmail: v.optional(v.string())
	}),
	handler: async (ctx, args) => {
		// Create agent thread (NO metadata field - it's ignored!)
		const { threadId } = await supportAgent.createThread(ctx, {
			userId: args.userId,
			title: args.title || 'Customer Support',
			summary: 'New support conversation'
		});

		// Get user info for denormalized search fields (skip anonymous users)
		let userName: string | undefined;
		let userEmail: string | undefined;

		if (args.userId && !isAnonymousUser(args.userId)) {
			try {
				const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
					model: 'user',
					where: [{ field: '_id', operator: 'eq', value: args.userId }]
				});
				if (user) {
					userName = user.name;
					userEmail = user.email;
				}
			} catch (error) {
				console.log(`[createThread] Failed to fetch user ${args.userId}:`, error);
			}
		}

		// Build denormalized search fields
		const title = args.title || 'Customer Support';
		const summary = 'New support conversation';
		const searchText = buildSearchText({ title, summary, userName, userEmail });

		// Create supportThread record with admin metadata + search fields
		await ctx.db.insert('supportThreads', {
			threadId,
			userId: args.userId,
			status: 'open',
			isHandedOff: false, // AI responds by default, user can request handoff
			awaitingAdminResponse: true, // User is waiting for first response
			assignedTo: undefined,
			priority: undefined,
			pageUrl: args.pageUrl || undefined,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			// Auto-enable notifications for authenticated users
			notificationEmail: userEmail,
			// Denormalized search fields
			searchText,
			title,
			summary,
			lastMessage: undefined,
			userName,
			userEmail
		});

		return { threadId, notificationEmail: userEmail };
	}
});

/**
 * List all threads for a user
 *
 * Returns paginated threads with last message preview and metadata.
 * Threads are ordered by most recent activity (last message time).
 *
 * @security For authenticated users, uses server-verified user ID (ignores client param).
 *           For anonymous users, uses client-provided userId (anonymous session).
 */
export const listThreads = query({
	args: {
		userId: v.optional(v.string()),
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
		// Security: Use server-verified user ID for authenticated users
		// For anonymous users (not authenticated), use client-provided userId
		const authUser = await authComponent.getAuthUser(ctx);
		let effectiveUserId: string | undefined;

		if (authUser) {
			// Authenticated: Always use server-verified user ID (prevents spoofing)
			effectiveUserId = authUser._id;
		} else if (args.userId && isAnonymousUser(args.userId)) {
			// Anonymous: Only allow querying with valid anonymous user IDs
			effectiveUserId = args.userId;
		} else {
			// No valid user ID - return empty results
			return { page: [], isDone: true, continueCursor: '' };
		}

		// Get threads from the agent component
		const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
			userId: effectiveUserId,
			paginationOpts: args.paginationOpts ?? { numItems: 20, cursor: null },
			order: 'desc'
		});

		// Get supportThreads for all threads (for handoff status, assigned admin, and notification email)
		const supportThreadsMap = new Map<
			string,
			{ isHandedOff?: boolean; assignedTo?: string; notificationEmail?: string }
		>();
		for (const thread of threads.page) {
			const supportThread = await ctx.db
				.query('supportThreads')
				.withIndex('by_thread', (q) => q.eq('threadId', thread._id))
				.first();
			if (supportThread) {
				supportThreadsMap.set(thread._id, {
					isHandedOff: supportThread.isHandedOff,
					assignedTo: supportThread.assignedTo,
					notificationEmail: supportThread.notificationEmail
				});
			}
		}

		// Collect unique admin IDs and fetch their info
		const adminIds = new Set<string>();
		for (const st of supportThreadsMap.values()) {
			if (st.assignedTo) adminIds.add(st.assignedTo);
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
			threads.page.map(async (thread) => {
				// Get the most recent completed message in this thread (exclude pending/streaming)
				const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
					threadId: thread._id,
					order: 'desc',
					statuses: ['success'],
					excludeToolMessages: true,
					paginationOpts: { numItems: 1, cursor: null }
				});

				const lastMessage = messages.page[0];
				const supportThread = supportThreadsMap.get(thread._id);
				const assignedAdmin = supportThread?.assignedTo
					? adminMap.get(supportThread.assignedTo)
					: undefined;

				return {
					_id: thread._id,
					_creationTime: thread._creationTime,
					userId: thread.userId,
					title: thread.title,
					summary: thread.summary,
					status: thread.status,
					lastAgentName: lastMessage?.agentName,
					lastMessageRole: lastMessage?.message?.role,
					lastMessage: lastMessage?.text,
					lastMessageAt: lastMessage?._creationTime ?? thread._creationTime,
					isHandedOff: supportThread?.isHandedOff ?? false,
					notificationEmail: supportThread?.notificationEmail,
					assignedAdmin
				};
			})
		);

		// Sort by lastMessageAt in descending order (most recent first)
		threadsWithLastMessage.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

		return {
			page: threadsWithLastMessage,
			isDone: threads.isDone,
			continueCursor: threads.continueCursor
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
		userId: v.optional(v.string()) // For anonymous users
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
		const thread = await supportAgent.getThreadMetadata(ctx, {
			threadId: args.threadId
		});

		// Security: Verify ownership
		const authUser = await authComponent.getAuthUser(ctx);

		if (authUser) {
			// Authenticated: Must own the thread
			if (thread.userId !== authUser._id) {
				throw new Error("Unauthorized: Cannot access another user's thread");
			}
		} else if (args.userId && isAnonymousUser(args.userId)) {
			// Anonymous: Must match the anonymous user ID
			if (thread.userId !== args.userId) {
				throw new Error("Unauthorized: Cannot access another user's thread");
			}
		} else {
			// No valid user identification
			throw new Error('Authentication required');
		}

		// Get supportThread to check handoff status and assigned admin
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

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
		userId: v.optional(v.string()) // For anonymous users
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		// Verify thread exists and user owns it
		const thread = await supportAgent.getThreadMetadata(ctx, {
			threadId: args.threadId
		});

		// Security: Verify ownership
		const authUser = await authComponent.getAuthUser(ctx);

		if (authUser) {
			if (thread.userId !== authUser._id) {
				throw new Error("Unauthorized: Cannot access another user's thread");
			}
		} else if (args.userId && isAnonymousUser(args.userId)) {
			if (thread.userId !== args.userId) {
				throw new Error("Unauthorized: Cannot access another user's thread");
			}
		} else {
			throw new Error('Authentication required');
		}

		// Get supportThread record
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

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
		await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'assistant',
				content:
					"Sure! I will connect you now. Please enter your email below and we'll notify you when our support team has responded. In the meantime, feel free to add any additional details that might help us assist you better."
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

		return true;
	}
});

/**
 * Update thread metadata
 *
 * Update title or summary of a thread (e.g., after analyzing conversation content).
 * Also syncs the denormalized search fields.
 */
export const updateThread = mutation({
	args: {
		threadId: v.string(),
		title: v.optional(v.string()),
		summary: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// Update agent thread metadata
		await supportAgent.updateThreadMetadata(ctx, {
			threadId: args.threadId,
			patch: {
				title: args.title,
				summary: args.summary
			}
		});

		// Sync denormalized search fields
		await ctx.runMutation(internal.support.threads.updateThreadMetadata, {
			threadId: args.threadId,
			title: args.title,
			summary: args.summary
		});

		return null;
	}
});

/**
 * Delete a thread
 *
 * Deletes a thread and all its messages asynchronously.
 */
export const deleteThread = mutation({
	args: {
		threadId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await supportAgent.deleteThreadAsync(ctx, {
			threadId: args.threadId,
			pageSize: 100
		});

		return null;
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
		userId: v.optional(v.string()) // For anonymous users
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		// Normalize email (empty string = unsubscribe)
		const normalizedEmail = args.email.trim().toLowerCase();

		// Validate email format only if non-empty (empty = unsubscribe)
		if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
			throw new Error('Invalid email format');
		}

		// Verify thread exists and user owns it
		const thread = await supportAgent.getThreadMetadata(ctx, {
			threadId: args.threadId
		});

		// Security: Verify ownership
		const authUser = await authComponent.getAuthUser(ctx);

		if (authUser) {
			if (thread.userId !== authUser._id) {
				throw new Error("Unauthorized: Cannot access another user's thread");
			}
		} else if (args.userId && isAnonymousUser(args.userId)) {
			if (thread.userId !== args.userId) {
				throw new Error("Unauthorized: Cannot access another user's thread");
			}
		} else {
			throw new Error('Authentication required');
		}

		// Get supportThread record
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

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
		const searchText = buildSearchText({
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

		// Get latest message (truncated to 500 chars for search)
		const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: args.threadId,
			order: 'desc',
			statuses: ['success'],
			excludeToolMessages: true,
			paginationOpts: { numItems: 1, cursor: null }
		});

		const lastMessageText = messages.page[0]?.text;
		const lastMessage = lastMessageText?.slice(0, 500);

		// Rebuild searchText
		const searchText = buildSearchText({
			title: supportThread.title,
			summary: supportThread.summary,
			lastMessage,
			userName: supportThread.userName,
			userEmail: supportThread.userEmail
		});

		await ctx.db.patch(supportThread._id, {
			lastMessage,
			searchText,
			updatedAt: Date.now()
		});
	}
});
