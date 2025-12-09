import { v } from 'convex/values';
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query
} from '../_generated/server';
import { components, internal } from '../_generated/api';
import { supportAgent } from './agent';
import { authComponent } from '../auth';

/**
 * Get user email from authentication
 */
export const getUserEmail = internalQuery({
	args: {
		threadId: v.string(),
		userId: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<{ email?: string; userName?: string }> => {
		if (args.userId) {
			const user = await authComponent.getAnyUserById(ctx, args.userId);
			if (user?.email) {
				return { email: user.email, userName: user.name };
			}
		}
		return {};
	}
});

/**
 * Transcript message type for email
 */
export type TranscriptMessage = {
	role: string;
	content: string;
	timestamp: number;
	attachments?: Array<{ filename: string; url: string }>;
};

/**
 * Get full chat transcript for a thread
 *
 * Returns all messages with timestamps and attachment URLs,
 * formatted for inclusion in admin notification emails.
 */
export const getThreadTranscript = internalQuery({
	args: {
		threadId: v.string()
	},
	handler: async (ctx, args): Promise<TranscriptMessage[]> => {
		// Get all messages in the thread
		const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: args.threadId,
			order: 'asc',
			paginationOpts: { numItems: 500, cursor: null }
		});

		const transcript: TranscriptMessage[] = [];

		for (const message of messages.page) {
			const role = message.message?.role;
			const content = message.message?.content;
			const timestamp = message._creationTime;

			// Skip messages without role
			if (!role) continue;

			let textContent = '';
			const attachments: Array<{ filename: string; url: string }> = [];

			// Parse content based on type
			if (typeof content === 'string') {
				textContent = content;
			} else if (Array.isArray(content)) {
				for (const part of content) {
					if (typeof part === 'object' && part !== null && 'type' in part) {
						if (part.type === 'text' && 'text' in part) {
							textContent += part.text;
						} else if (part.type === 'file' || part.type === 'image') {
							// FilePart from getFile() has url or data, not fileId
							// The url field contains the actual file URL, or data may contain a URL
							const url =
								'url' in part && typeof part.url === 'string'
									? part.url
									: 'data' in part && typeof part.data === 'string' && part.data.startsWith('http')
										? part.data
										: null;

							if (url) {
								attachments.push({
									filename:
										'filename' in part && typeof part.filename === 'string'
											? part.filename
											: 'attachment',
									url
								});
							}
						} else if (part.type === 'tool-call' && 'toolName' in part) {
							textContent += `[Tool-Call: ${part.toolName}]`;
						} else if (part.type === 'tool-result' && 'toolName' in part && 'output' in part) {
							const output =
								typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
							textContent += `[Tool-Result: ${part.toolName}] ${output}`;
						}
					}
				}
			}

			// Only add messages with content or attachments
			if (textContent.trim() || attachments.length > 0) {
				transcript.push({
					role,
					content: textContent.trim(),
					timestamp,
					attachments: attachments.length > 0 ? attachments : undefined
				});
			}
		}

		return transcript;
	}
});

/**
 * Get files uploaded in a thread
 */
export const getThreadFiles = internalQuery({
	args: {
		threadId: v.string()
	},
	handler: async (ctx, args): Promise<Array<{ filename: string; url: string; size: number }>> => {
		// Get all messages in the thread
		const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: args.threadId,
			order: 'asc',
			paginationOpts: { numItems: 100, cursor: null }
		});

		const files: Array<{ filename: string; url: string; size: number }> = [];
		const seenUrls = new Set<string>();

		for (const message of messages.page) {
			// Check message content for file parts
			const content = message.message?.content;
			if (!Array.isArray(content)) continue;

			for (const part of content) {
				if (typeof part === 'object' && part !== null && 'type' in part) {
					// File or image parts from the agent component
					if (part.type === 'file' || part.type === 'image') {
						// FilePart from getFile() has url or data, not fileId
						const url =
							'url' in part && typeof part.url === 'string'
								? part.url
								: 'data' in part && typeof part.data === 'string' && part.data.startsWith('http')
									? part.data
									: null;

						if (url && !seenUrls.has(url)) {
							seenUrls.add(url);
							files.push({
								filename:
									'filename' in part && typeof part.filename === 'string'
										? part.filename
										: 'attachment',
								url,
								size: 0 // Size not directly available, will be checked during attachment
							});
						}
					}
				}
			}
		}

		return files;
	}
});

/**
 * Store ticket in database (legacy - kept for backwards compatibility)
 */
export const storeTicket = internalMutation({
	args: {
		threadId: v.string(),
		ticketType: v.union(
			v.literal('bug_report'),
			v.literal('feature_request'),
			v.literal('general_inquiry')
		),
		title: v.string(),
		description: v.string(),
		userEmail: v.string(),
		userName: v.optional(v.string()),
		userId: v.optional(v.string()),
		fileIds: v.array(v.object({ filename: v.string(), url: v.string() })),
		emailId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const ticketId = await ctx.db.insert('supportTickets', {
			threadId: args.threadId,
			ticketType: args.ticketType,
			title: args.title,
			description: args.description,
			userEmail: args.userEmail,
			userName: args.userName,
			userId: args.userId,
			fileIds: args.fileIds,
			status: 'submitted',
			emailId: args.emailId,
			submittedAt: Date.now()
		});

		return ticketId;
	}
});

/**
 * Store ticket in database with pending email delivery status
 *
 * Also stores toolCallId and promptMessageId so we can save the tool-result
 * and continue agent generation later (when webhook confirms delivery).
 */
export const storeTicketWithPendingStatus = internalMutation({
	args: {
		threadId: v.string(),
		ticketType: v.union(
			v.literal('bug_report'),
			v.literal('feature_request'),
			v.literal('general_inquiry')
		),
		title: v.string(),
		description: v.string(),
		userEmail: v.string(),
		userName: v.optional(v.string()),
		userId: v.optional(v.string()),
		fileIds: v.array(v.object({ filename: v.string(), url: v.string() })),
		toolCallId: v.string(),
		promptMessageId: v.string()
	},
	handler: async (ctx, args) => {
		const ticketId = await ctx.db.insert('supportTickets', {
			threadId: args.threadId,
			ticketType: args.ticketType,
			title: args.title,
			description: args.description,
			userEmail: args.userEmail,
			userName: args.userName,
			userId: args.userId,
			fileIds: args.fileIds,
			status: 'submitted',
			emailDeliveryStatus: 'pending',
			toolCallId: args.toolCallId,
			promptMessageId: args.promptMessageId,
			submittedAt: Date.now()
		});

		return ticketId;
	}
});

/**
 * Update ticket with user email ID
 */
export const updateTicketUserEmailId = internalMutation({
	args: {
		ticketId: v.id('supportTickets'),
		userEmailId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.ticketId, {
			userEmailId: args.userEmailId
		});
	}
});

/**
 * Get ticket delivery status for UI subscription
 *
 * Returns the current email delivery status so the UI can
 * update from processing -> success/error based on webhook events.
 */
export const getTicketDeliveryStatus = query({
	args: {
		threadId: v.string(),
		toolCallId: v.string()
	},
	handler: async (ctx, args) => {
		// Find the most recent ticket for this thread
		const ticket = await ctx.db
			.query('supportTickets')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.order('desc')
			.first();

		if (!ticket) {
			return { status: 'not_found' as const };
		}

		return {
			status: ticket.emailDeliveryStatus || 'pending',
			error: ticket.emailError,
			ticketId: ticket._id
		};
	}
});

/**
 * Check if a ticket already exists for a thread/title combination
 *
 * Used by the UI to determine if the ticket form should show
 * the submitted state on reload.
 */
export const getTicketForThread = query({
	args: {
		threadId: v.string(),
		title: v.string()
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query('supportTickets')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.filter((q) => q.eq(q.field('title'), args.title))
			.first();
	}
});

/**
 * Public query to get pre-filled email for the UI
 *
 * Returns the user's email if available from:
 * 1. Authenticated user (if logged in)
 * 2. Previous ticket in this thread
 */
export const getEmailForThread = query({
	args: { threadId: v.string() },
	handler: async (ctx, args): Promise<string | null> => {
		// Check authenticated user first
		const identity = await ctx.auth.getUserIdentity();
		if (identity?.email) {
			return identity.email;
		}

		// Check previous tickets in this thread
		const previousTicket = await ctx.db
			.query('supportTickets')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.order('desc')
			.first();

		return previousTicket?.userEmail ?? null;
	}
});

/**
 * Check how many tool calls are still pending (awaiting user response)
 *
 * Used to determine if we should continue agent generation after a tool result.
 * Only continues when ALL tool calls from the same assistant response have results.
 */
export const getPendingToolCalls = internalQuery({
	args: {
		threadId: v.string(),
		promptMessageId: v.string()
	},
	handler: async (ctx, args): Promise<{ pending: number; total: number }> => {
		// Get all messages in thread
		const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: args.threadId,
			paginationOpts: { numItems: 50, cursor: null },
			order: 'asc'
		});

		// Find prompt message's order
		const promptMsg = messages.page.find((m) => m._id === args.promptMessageId);
		if (!promptMsg) return { pending: 0, total: 0 };

		// Find assistant messages after prompt with tool calls
		// Note: Assistant responses have the SAME order as the user prompt, but higher stepOrder
		const assistantMsgs = messages.page.filter(
			(m) =>
				m.message?.role === 'assistant' &&
				(m.order > promptMsg.order ||
					(m.order === promptMsg.order && m.stepOrder > promptMsg.stepOrder))
		);

		// Extract all toolCallIds from assistant messages
		const toolCallIds: string[] = [];
		for (const msg of assistantMsgs) {
			const content = msg.message?.content;
			if (Array.isArray(content)) {
				for (const part of content) {
					if (
						part &&
						typeof part === 'object' &&
						'type' in part &&
						part.type === 'tool-call' &&
						'toolCallId' in part
					) {
						toolCallIds.push(part.toolCallId);
					}
				}
			}
		}

		if (toolCallIds.length === 0) return { pending: 0, total: 0 };

		// Count tool-result messages
		const toolMsgs = messages.page.filter((m) => m.message?.role === 'tool');
		const resultIds = new Set<string>();
		for (const msg of toolMsgs) {
			const content = msg.message?.content;
			if (Array.isArray(content)) {
				for (const part of content) {
					if (
						part &&
						typeof part === 'object' &&
						'type' in part &&
						part.type === 'tool-result' &&
						'toolCallId' in part
					) {
						resultIds.add(part.toolCallId);
					}
				}
			}
		}

		const answered = toolCallIds.filter((id) => resultIds.has(id)).length;
		return { pending: toolCallIds.length - answered, total: toolCallIds.length };
	}
});

/**
 * Handle user action on ticket tool (submit or cancel)
 *
 * Human-in-the-loop pattern: validates input, then schedules
 * an action to save tool-result and continue agent generation.
 *
 * Note: We use a mutation for validation, then an internalAction
 * for agent.saveMessage and agent.streamText which require action context.
 */
export const submitTicketToolResult = mutation({
	args: {
		threadId: v.string(),
		toolCallId: v.string(),
		promptMessageId: v.string(),
		action: v.union(v.literal('submitted'), v.literal('cancelled')),
		// For submitted action (required when action=submitted):
		ticketType: v.optional(
			v.union(v.literal('bug_report'), v.literal('feature_request'), v.literal('general_inquiry'))
		),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		email: v.optional(v.string()),
		includeAttachments: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		const userId = identity?.subject;

		if (args.action === 'submitted') {
			// Validate required fields
			if (!args.email || !args.title || !args.description || !args.ticketType) {
				throw new Error('Missing required fields for ticket submission');
			}
		}

		// Schedule the action to save tool-result and continue generation
		// (agent.saveMessage and agent.streamText require action context)
		await ctx.scheduler.runAfter(0, internal.support.ticketHelpers.processTicketToolResult, {
			threadId: args.threadId,
			toolCallId: args.toolCallId,
			promptMessageId: args.promptMessageId,
			action: args.action,
			ticketType: args.ticketType,
			title: args.title,
			description: args.description,
			email: args.email,
			includeAttachments: args.includeAttachments,
			userId
		});

		return { status: args.action };
	}
});

/**
 * Process ticket tool result (internal action)
 *
 * Called after submitTicketToolResult mutation. This action handles two cases:
 *
 * For 'submitted' action:
 * - Schedules ticket submission (which sends user email)
 * - Does NOT save tool-result yet (waits for email delivery webhook)
 * - Does NOT continue agent generation yet (waits for webhook)
 * - Tool-result will be saved by handleEmailEvent or checkEmailDeliveryTimeout
 *
 * For 'cancelled' action:
 * - Saves tool-result immediately with cancelled status
 * - Continues agent generation
 */
export const processTicketToolResult = internalAction({
	args: {
		threadId: v.string(),
		toolCallId: v.string(),
		promptMessageId: v.string(),
		action: v.union(v.literal('submitted'), v.literal('cancelled')),
		ticketType: v.optional(
			v.union(v.literal('bug_report'), v.literal('feature_request'), v.literal('general_inquiry'))
		),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		email: v.optional(v.string()),
		includeAttachments: v.optional(v.boolean()),
		userId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		console.log('[HITL] processTicketToolResult started:', {
			action: args.action,
			threadId: args.threadId,
			promptMessageId: args.promptMessageId
		});

		if (args.action === 'submitted') {
			// Schedule ticket submission - passes toolCallId and promptMessageId
			// so the webhook handler can save tool-result and continue agent later
			await ctx.scheduler.runAfter(0, internal.support.tickets.submitTicket, {
				threadId: args.threadId,
				userId: args.userId,
				ticketType: args.ticketType!,
				title: args.title!,
				description: args.description!,
				email: args.email!,
				includeAttachments: args.includeAttachments ?? true,
				toolCallId: args.toolCallId,
				promptMessageId: args.promptMessageId
			});

			// DO NOT save tool-result yet - wait for email delivery webhook
			// DO NOT continue agent generation yet - wait for webhook
			console.log('[HITL] Ticket submission scheduled, waiting for email delivery webhook...');
			return;
		}

		// For cancelled action: save tool-result and continue agent immediately
		const { messageId } = await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						output: {
							type: 'text',
							value: JSON.stringify({
								status: 'cancelled',
								message: 'You cancelled the form submission.'
							})
						},
						toolCallId: args.toolCallId,
						toolName: 'submitSupportTicket'
					}
				]
			}
		});
		console.log('[HITL] Tool-result (cancelled) saved:', messageId);

		// Check if all tool calls have been answered before continuing
		const { pending, total } = await ctx.runQuery(
			internal.support.ticketHelpers.getPendingToolCalls,
			{
				threadId: args.threadId,
				promptMessageId: args.promptMessageId
			}
		);

		if (pending > 0) {
			console.log(
				`[HITL] ${pending} of ${total} tool calls still pending, waiting for all results...`
			);
			return;
		}

		// Continue generating
		console.log('[HITL] Continuing agent generation...');
		try {
			await supportAgent.generateText(
				ctx,
				{ threadId: args.threadId, userId: args.userId },
				{ promptMessageId: args.promptMessageId }
			);
			console.log('[HITL] generateText completed successfully');
		} catch (error) {
			console.error('[HITL] generateText error:', error);
			throw error;
		}
	}
});

/**
 * Get ticket by ID (internal query for actions)
 *
 * Note: This is in ticketHelpers.ts (not tickets.ts) because tickets.ts uses
 * 'use node' which only allows actions, not queries/mutations.
 */
export const getTicketById = internalQuery({
	args: {
		ticketId: v.id('supportTickets')
	},
	handler: async (ctx, args) => {
		return await ctx.db.get(args.ticketId);
	}
});

/**
 * Update ticket email delivery status
 *
 * Note: This is in ticketHelpers.ts (not tickets.ts) because tickets.ts uses
 * 'use node' which only allows actions, not queries/mutations.
 */
export const updateTicketEmailStatus = internalMutation({
	args: {
		ticketId: v.id('supportTickets'),
		status: v.union(v.literal('pending'), v.literal('delivered'), v.literal('failed')),
		error: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.ticketId, {
			emailDeliveryStatus: args.status,
			emailError: args.error
		});
	}
});

/**
 * Update ticket with admin email ID
 *
 * Note: This is in ticketHelpers.ts (not tickets.ts) because tickets.ts uses
 * 'use node' which only allows actions, not queries/mutations.
 */
export const updateTicketAdminEmailId = internalMutation({
	args: {
		ticketId: v.id('supportTickets'),
		adminEmailId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.ticketId, {
			adminEmailId: args.adminEmailId
		});
	}
});

/**
 * Check email delivery timeout
 *
 * Scheduled 30 seconds after sending user email.
 * If status is still pending, mark as failed and complete the tool-result.
 *
 * Note: This is in ticketHelpers.ts (not tickets.ts) because tickets.ts uses
 * 'use node' which only allows actions, not mutations.
 */
export const checkEmailDeliveryTimeout = internalMutation({
	args: {
		ticketId: v.id('supportTickets')
	},
	handler: async (ctx, args) => {
		const ticket = await ctx.db.get(args.ticketId);

		if (!ticket) {
			console.error('Ticket not found for timeout check:', args.ticketId);
			return;
		}

		// Only update if still pending
		if (ticket.emailDeliveryStatus === 'pending') {
			const errorMessage = 'Email delivery timed out. Please try again.';
			console.log('Email delivery timed out for ticket:', args.ticketId);

			await ctx.db.patch(args.ticketId, {
				emailDeliveryStatus: 'failed',
				emailError: errorMessage
			});

			// Save tool-result with error and continue agent generation
			if (ticket.toolCallId && ticket.promptMessageId) {
				await ctx.scheduler.runAfter(0, internal.emails.events.completeTicketToolResult, {
					threadId: ticket.threadId,
					toolCallId: ticket.toolCallId,
					promptMessageId: ticket.promptMessageId,
					ticketId: args.ticketId.toString(),
					status: 'error',
					errorMessage
				});
			}
		}
	}
});
