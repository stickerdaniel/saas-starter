import { internalAction, mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { supportAgent } from './agent';
import { paginationOptsValidator } from 'convex/server';

/**
 * Send a user message and get AI response with streaming
 *
 * This mutation saves the user's message and schedules an internal action
 * to generate the AI response asynchronously with streaming support.
 */
export const sendMessage = mutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		userId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Save the user's message first
		// Skip embeddings in mutation - they'll be generated lazily when needed
		const { messageId } = await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			prompt: args.prompt,
			skipEmbeddings: true
		});

		// Schedule async action to generate AI response with streaming
		await ctx.scheduler.runAfter(0, internal.support.messages.generateResponse, {
			threadId: args.threadId,
			promptMessageId: messageId,
			userId: args.userId
		});

		return { messageId };
	}
});

/**
 * Internal action to generate AI response with streaming
 *
 * This runs asynchronously and streams the AI response back to the database,
 * which automatically syncs to all connected clients via Convex's reactivity.
 */
export const generateResponse = internalAction({
	args: {
		threadId: v.string(),
		promptMessageId: v.string(),
		userId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Stream the AI response
		const result = await supportAgent.streamText(
			ctx,
			{ threadId: args.threadId, userId: args.userId },
			{
				promptMessageId: args.promptMessageId
			},
			{
				// Save streaming deltas to database for real-time updates
				saveStreamDeltas: {
					chunking: 'word', // Stream word by word for smooth UX
					throttleMs: 50 // Throttle updates to avoid overwhelming the database
				}
			}
		);

		// Consume the stream to ensure it completes
		await result.consumeStream();
	}
});

/**
 * List messages in a thread with streaming support
 *
 * Returns paginated messages and includes streaming state for in-progress messages.
 * This query is reactive and will automatically update when new messages or
 * streaming deltas arrive.
 */
export const listMessages = query({
	args: {
		threadId: v.string(),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, args) => {
		// Get paginated messages
		const result = await supportAgent.listMessages(ctx, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts,
			excludeToolMessages: true, // Hide internal tool call messages from UI
			statuses: ['success', 'pending', 'failed'] // Include all relevant statuses
		});

		return result;
	}
});

/**
 * Delete a message
 *
 * Removes a message from the thread. Useful for moderating content
 * or allowing users to remove their messages.
 */
export const deleteMessage = mutation({
	args: {
		messageId: v.string()
	},
	handler: async (ctx, args) => {
		await supportAgent.deleteMessage(ctx, {
			messageId: args.messageId
		});
	}
});
