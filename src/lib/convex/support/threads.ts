import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { supportAgent } from './agent';
import { components } from '../_generated/api';
import { paginationOptsValidator } from 'convex/server';

/**
 * Create a new support thread
 *
 * Creates a conversation thread for customer support.
 * Each user can have multiple threads for different support topics.
 */
export const createThread = mutation({
	args: {
		userId: v.optional(v.string()),
		title: v.optional(v.string())
	},
	returns: v.string(),
	handler: async (ctx, args) => {
		const { threadId } = await supportAgent.createThread(ctx, {
			userId: args.userId,
			title: args.title || 'Customer Support',
			summary: 'New support conversation'
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
 */
export const updateThread = mutation({
	args: {
		threadId: v.string(),
		title: v.optional(v.string()),
		summary: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await supportAgent.updateThreadMetadata(ctx, {
			threadId: args.threadId,
			patch: {
				title: args.title,
				summary: args.summary
			}
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
