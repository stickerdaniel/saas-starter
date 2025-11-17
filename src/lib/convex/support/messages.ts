import { internalAction, mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { supportAgent } from './agent';
import { paginationOptsValidator } from 'convex/server';
import { listUIMessages, syncStreams, getFile } from '@convex-dev/agent';
import { vStreamArgs } from '@convex-dev/agent/validators';
import { components } from '../_generated/api';
import type { UserContent } from 'ai';

/**
 * Send a user message and get AI response with streaming
 *
 * This mutation saves the user's message and schedules an internal action
 * to generate the AI response asynchronously with streaming support.
 *
 * Supports multimodal messages with file and image attachments.
 */
export const sendMessage = mutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		userId: v.optional(v.string()),
		fileIds: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		let messageId: string;

		// Check if we have file attachments
		if (args.fileIds && args.fileIds.length > 0) {
			// Build multimodal message content
			const content: UserContent = [];

			// Add text part
			if (args.prompt.trim()) {
				content.push({
					type: 'text',
					text: args.prompt
				});
			}

			// Add file/image parts
			for (const fileId of args.fileIds) {
				const { filePart, imagePart } = await getFile(ctx, components.agent, fileId);

				// Use imagePart for images (better model support), filePart for other files
				if (imagePart) {
					content.push(imagePart);
				} else {
					content.push(filePart);
				}
			}

			// Save multimodal message
			const result = await supportAgent.saveMessage(ctx, {
				threadId: args.threadId,
				message: {
					role: 'user',
					content
				},
				skipEmbeddings: true
			});

			messageId = result.messageId;
		} else {
			// Save text-only message
			const result = await supportAgent.saveMessage(ctx, {
				threadId: args.threadId,
				prompt: args.prompt,
				skipEmbeddings: true
			});

			messageId = result.messageId;
		}

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
					chunking: 'word', // Word-level chunking for smooth streaming
					throttleMs: 30 // ~33fps update rate for smooth animation
				}
			}
		);

		// Let the stream process asynchronously for progressive updates
		void result.consumeStream();
	}
});

/**
 * List messages in a thread with streaming support
 *
 * Returns paginated messages with streaming deltas included.
 * This query is reactive and will automatically update when new messages or
 * streaming deltas arrive.
 */
export const listMessages = query({
	args: {
		threadId: v.string(),
		paginationOpts: paginationOptsValidator,
		streamArgs: vStreamArgs
	},
	handler: async (ctx, args) => {
		// Get paginated UIMessages (includes id field and text for display)
		const paginated = await listUIMessages(ctx, components.agent, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts
		});

		// Get streaming deltas for in-progress messages
		const streams = await syncStreams(ctx, components.agent, {
			threadId: args.threadId,
			streamArgs: args.streamArgs,
			includeStatuses: ['streaming', 'finished', 'aborted']
		});

		return { ...paginated, streams };
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
