import { mutation, query, internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { supportAgent } from './agent';
import { components, internal } from '../_generated/api';
import { paginationOptsValidator } from 'convex/server';

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
	returns: v.string(),
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

		if (args.userId && !args.userId.startsWith('anon_')) {
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
			assignedTo: undefined,
			priority: undefined,
			pageUrl: args.pageUrl || undefined,
			unreadByAdmin: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			// Denormalized search fields
			searchText,
			title,
			summary,
			lastMessage: undefined,
			userName,
			userEmail
		});

		return threadId;
	}
});

/**
 * List all threads for a user
 *
 * Returns paginated threads with last message preview and metadata.
 * Threads are ordered by most recent activity (last message time).
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
				lastMessageAt: v.optional(v.number())
			})
		),
		isDone: v.boolean(),
		continueCursor: v.string()
	}),
	handler: async (ctx, args) => {
		// Get threads from the agent component
		const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
			userId: args.userId,
			paginationOpts: args.paginationOpts ?? { numItems: 20, cursor: null },
			order: 'desc'
		});

		// For each thread, get the last message
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
					lastMessageAt: lastMessage?._creationTime ?? thread._creationTime
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
 */
export const getThread = query({
	args: {
		threadId: v.string()
	},
	returns: v.object({
		_id: v.string(),
		_creationTime: v.number(),
		userId: v.optional(v.string()),
		title: v.optional(v.string()),
		summary: v.optional(v.string()),
		status: v.union(v.literal('active'), v.literal('archived'))
	}),
	handler: async (ctx, args) => {
		const thread = await supportAgent.getThreadMetadata(ctx, {
			threadId: args.threadId
		});

		return thread;
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
		await ctx.runMutation(internal.support.threads.syncThreadMetadata, {
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
 * This is a public query since it only exposes non-sensitive profile data.
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
// Internal Sync Mutations (for keeping denormalized search fields in sync)
// ============================================================================

/**
 * Sync thread metadata (title/summary) to denormalized search fields.
 * Called when thread metadata is updated.
 */
export const syncThreadMetadata = internalMutation({
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
export const syncLastMessage = internalMutation({
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
