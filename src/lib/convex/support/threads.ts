import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { supportAgent } from './agent';

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
 * Get a specific thread
 *
 * Retrieves thread metadata including title, summary, and creation time.
 */
export const getThread = query({
	args: {
		threadId: v.string()
	},
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
	handler: async (ctx, args) => {
		await supportAgent.updateThreadMetadata(ctx, {
			threadId: args.threadId,
			patch: {
				title: args.title,
				summary: args.summary
			}
		});
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
	handler: async (ctx, args) => {
		await supportAgent.deleteThreadAsync(ctx, {
			threadId: args.threadId,
			pageSize: 100
		});
	}
});
