import { v } from 'convex/values';
import { internal, components } from '../../_generated/api';
import { saveMessage, getFile } from '@convex-dev/agent';
import { adminMutation } from '../../functions';
import { shouldSendNotification } from '../../support/threads';
import type { AssistantContent, TextPart, FilePart } from 'ai';

/**
 * Assign thread to admin
 *
 * Updates the supportThreads table (agent threads don't support metadata).
 */
export const assignThread = adminMutation({
	args: {
		threadId: v.string(),
		adminUserId: v.optional(v.string()) // undefined to unassign
	},
	handler: async (ctx, args) => {
		// Find supportThread by threadId
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

		// Update assignedTo
		await ctx.db.patch(supportThread._id, {
			assignedTo: args.adminUserId,
			updatedAt: Date.now()
		});
	}
});

/**
 * Update thread status
 */
export const updateThreadStatus = adminMutation({
	args: {
		threadId: v.string(),
		status: v.union(v.literal('open'), v.literal('done'))
	},
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

		await ctx.db.patch(supportThread._id, {
			status: args.status,
			updatedAt: Date.now()
		});
	}
});

/**
 * Update thread priority
 */
export const updateThreadPriority = adminMutation({
	args: {
		threadId: v.string(),
		priority: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high')))
	},
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

		await ctx.db.patch(supportThread._id, {
			priority: args.priority,
			updatedAt: Date.now()
		});
	}
});

/**
 * Send admin reply to thread
 *
 * This adds a human admin message (distinct from AI) using message metadata.
 * Does NOT trigger AI response. Auto-assigns thread to admin on first reply.
 */
export const sendAdminReply = adminMutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		fileIds: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		// Validate content
		if (!args.prompt.trim() && (!args.fileIds || args.fileIds.length === 0)) {
			throw new Error('Message content cannot be empty');
		}

		// Get support thread for auto-assign and read status
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();

		if (!supportThread) {
			throw new Error('Support thread not found');
		}

		// Save admin message with role: "assistant" and human provider metadata
		// Using standalone saveMessage to set custom agentName (Agent.saveMessage uses agent's name)
		const adminName = ctx.user.name || ctx.user.email || 'Admin';

		// Build message content (multimodal if files attached)
		let messageContent: string | AssistantContent = args.prompt.trim();

		if (args.fileIds && args.fileIds.length > 0) {
			// Build multimodal message content (assistant role accepts text + file parts)
			const content: (TextPart | FilePart)[] = [];

			// Add text part if present
			if (args.prompt.trim()) {
				content.push({
					type: 'text',
					text: args.prompt.trim()
				});
			}

			// Add file parts
			for (const fileId of args.fileIds) {
				const { filePart } = await getFile(ctx, components.agent, fileId);
				content.push(filePart);
			}

			messageContent = content;
		}

		const result = await saveMessage(ctx, components.agent, {
			threadId: args.threadId,
			agentName: adminName,
			message: {
				role: 'assistant',
				content: messageContent
			},
			metadata: {
				provider: 'human',
				providerMetadata: {
					admin: {
						isAdminMessage: true,
						adminUserId: ctx.user._id,
						adminName,
						adminEmail: ctx.user.email
					}
				}
			}
		});

		// Auto-assign to current admin if not already assigned (enables HITL mode)
		// When assigned, user messages won't trigger AI responses
		const shouldAutoAssign = !supportThread.assignedTo;

		// Check if we should send email notification (30-minute cooldown)
		const shouldNotify = shouldSendNotification(
			supportThread.notificationEmail,
			supportThread.notificationSentAt
		);

		// Update thread: read status, assignment, and notification timestamp
		await ctx.db.patch(supportThread._id, {
			unreadByAdmin: false,
			updatedAt: Date.now(),
			...(shouldAutoAssign && { assignedTo: ctx.user._id }),
			// Update timestamp FIRST to prevent race conditions with concurrent replies
			...(shouldNotify && { notificationSentAt: Date.now() })
		});

		// Schedule notification email (async - doesn't block response)
		if (shouldNotify && supportThread.notificationEmail) {
			await ctx.scheduler.runAfter(0, internal.emails.send.sendAdminReplyNotification, {
				email: supportThread.notificationEmail,
				adminName,
				messagePreview: args.prompt.trim().slice(0, 200)
			});
		}

		// Sync denormalized search fields
		await ctx.runMutation(internal.support.threads.syncLastMessage, {
			threadId: args.threadId
		});
	}
});

/**
 * Add internal note for a user (not visible to users)
 *
 * Supports both authenticated users and anonymous users (anon_* IDs).
 */
export const addInternalUserNote = adminMutation({
	args: {
		userId: v.string(), // Better Auth user ID or anon_*
		content: v.string()
	},
	handler: async (ctx, args) => {
		// Validate content
		if (!args.content.trim()) {
			throw new Error('Note content cannot be empty');
		}

		await ctx.db.insert('internalUserNotes', {
			userId: args.userId,
			adminUserId: ctx.user._id,
			content: args.content.trim(),
			createdAt: Date.now()
		});
	}
});

/**
 * Delete internal user note
 */
export const deleteInternalUserNote = adminMutation({
	args: {
		noteId: v.id('internalUserNotes')
	},
	handler: async (ctx, args) => {
		const note = await ctx.db.get(args.noteId);

		if (!note) {
			throw new Error('Note not found');
		}

		await ctx.db.delete(args.noteId);
	}
});
