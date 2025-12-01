import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { vEmailId, vEmailEvent } from '@convex-dev/resend';
import { supportAgent } from '../support/agent';

/**
 * Email event handler - called by Resend webhooks
 *
 * Handles email lifecycle events:
 * - delivered: Email successfully delivered to recipient
 * - bounced: Email bounced (hard or soft bounce)
 * - complained: Recipient marked email as spam
 * - opened: Recipient opened the email (requires tracking)
 * - clicked: Recipient clicked a link (requires tracking)
 *
 * For support tickets:
 * - On user email delivered: Schedule admin notification email
 * - On admin email delivered: Update ticket status to 'delivered', save tool-result, continue agent
 * - On bounce: Update ticket status to 'failed', save tool-result with error, continue agent
 *
 * This function is called automatically when Resend sends a webhook event.
 * Configure the webhook URL in Resend dashboard to point to:
 * https://your-deployment.convex.site/resend-webhook
 */
export const handleEmailEvent = internalMutation({
	args: {
		id: vEmailId,
		event: vEmailEvent
	},
	handler: async (ctx, args) => {
		// Log the event for monitoring and debugging
		console.log('Email event received:', {
			emailId: args.id,
			event: args.event
		});

		// Store the event in the database for analytics
		await ctx.db.insert('emailEvents', {
			emailId: args.id,
			eventType: args.event.type,
			timestamp: Date.now(),
			data: args.event
		});

		// Check if this email is associated with a support ticket
		// First check if it's a user confirmation email
		const ticketByUserEmail = await ctx.db
			.query('supportTickets')
			.withIndex('by_user_email_id', (q) => q.eq('userEmailId', args.id))
			.first();

		// Then check if it's an admin notification email
		const ticketByAdminEmail = await ctx.db
			.query('supportTickets')
			.withIndex('by_admin_email_id', (q) => q.eq('adminEmailId', args.id))
			.first();

		const ticket = ticketByUserEmail || ticketByAdminEmail;
		const isUserEmail = !!ticketByUserEmail;
		const isAdminEmail = !!ticketByAdminEmail;

		// Handle specific event types
		switch (args.event.type) {
			case 'email.delivered':
				console.log(`Email ${args.id} delivered successfully`);

				if (ticket && ticket.emailDeliveryStatus === 'pending') {
					if (isUserEmail) {
						// User email delivered - now send admin notification
						console.log(
							`[Ticket] User email delivered for ticket ${ticket._id}, scheduling admin email`
						);
						await ctx.scheduler.runAfter(0, internal.support.tickets.sendAdminNotificationEmail, {
							ticketId: ticket._id
						});
					} else if (isAdminEmail) {
						// Admin email delivered - ticket is fully submitted!
						console.log(
							`[Ticket] Admin email delivered for ticket ${ticket._id}, marking as delivered`
						);
						await ctx.db.patch(ticket._id, {
							emailDeliveryStatus: 'delivered'
						});

						// Save tool-result and continue agent generation
						if (ticket.toolCallId && ticket.promptMessageId) {
							await ctx.scheduler.runAfter(0, internal.emails.events.completeTicketToolResult, {
								threadId: ticket.threadId,
								toolCallId: ticket.toolCallId,
								promptMessageId: ticket.promptMessageId,
								ticketId: ticket._id.toString(),
								status: 'success'
							});
						}
					}
				}
				break;

			case 'email.bounced':
				console.warn(`Email ${args.id} bounced:`, args.event.data);

				if (ticket && ticket.emailDeliveryStatus === 'pending') {
					const bounceType = isUserEmail ? 'user confirmation' : 'admin notification';
					const errorMessage = `Your ${bounceType} email could not be delivered. Please check your email address and try again.`;

					console.log(`[Ticket] Email bounced for ticket ${ticket._id} (${bounceType})`);
					await ctx.db.patch(ticket._id, {
						emailDeliveryStatus: 'failed',
						emailError: errorMessage
					});

					// Save tool-result with error and continue agent generation
					if (ticket.toolCallId && ticket.promptMessageId) {
						await ctx.scheduler.runAfter(0, internal.emails.events.completeTicketToolResult, {
							threadId: ticket.threadId,
							toolCallId: ticket.toolCallId,
							promptMessageId: ticket.promptMessageId,
							ticketId: ticket._id.toString(),
							status: 'error',
							errorMessage
						});
					}
				}
				break;

			case 'email.complained':
				// User marked as spam - important for reputation
				console.warn(`Email ${args.id} marked as spam by recipient`);
				// TODO: Unsubscribe user or add to suppression list
				break;

			case 'email.opened':
				// Email was opened (requires tracking to be enabled)
				console.log(`Email ${args.id} opened by recipient`);
				break;

			case 'email.clicked':
				// Link was clicked (requires tracking to be enabled)
				console.log(`Email ${args.id} link clicked by recipient`);
				break;

			default:
				console.log(`Unknown email event type: ${args.event.type}`);
		}
	}
});

/**
 * Complete ticket tool result (internal action)
 *
 * Called after email delivery confirmation (success) or failure (bounce/timeout).
 * This action saves the tool-result message and continues agent generation.
 *
 * This is the deferred part of the HITL pattern - the tool-result is only
 * saved after we know the email delivery outcome.
 */
export const completeTicketToolResult = internalAction({
	args: {
		threadId: v.string(),
		toolCallId: v.string(),
		promptMessageId: v.string(),
		ticketId: v.string(),
		status: v.union(v.literal('success'), v.literal('error')),
		errorMessage: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		console.log('[HITL] completeTicketToolResult:', {
			threadId: args.threadId,
			toolCallId: args.toolCallId,
			status: args.status
		});

		// Build the tool result based on status
		const toolResultValue =
			args.status === 'success'
				? {
						status: 'submitted',
						message:
							'Your support ticket has been submitted successfully. You should receive a confirmation email shortly.',
						ticketId: args.ticketId
					}
				: {
						status: 'error',
						message: args.errorMessage || 'Failed to submit ticket. Please try again.'
					};

		// Save the tool-result message
		const { messageId } = await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						output: {
							type: 'text',
							value: JSON.stringify(toolResultValue)
						},
						toolCallId: args.toolCallId,
						toolName: 'submitSupportTicket'
					}
				]
			}
		});
		console.log('[HITL] Tool-result saved:', messageId);

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

		// Continue generating agent response
		console.log('[HITL] All tool calls answered, continuing agent generation...');
		try {
			await supportAgent.generateText(
				ctx,
				{ threadId: args.threadId },
				{ promptMessageId: args.promptMessageId }
			);
			console.log('[HITL] generateText completed successfully');
		} catch (error) {
			console.error('[HITL] generateText error:', error);
			throw error;
		}
	}
});
