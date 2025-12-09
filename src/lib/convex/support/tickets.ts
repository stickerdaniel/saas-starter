'use node';

import { v } from 'convex/values';
import type { FunctionReference } from 'convex/server';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { Resend } from 'resend';
import { resend as resendComponent } from '../emails/resend';
import { supportAgent } from './agent';

/**
 * Maximum total attachment size for email (30MB)
 * Files exceeding this limit will only be included as download links
 */
const MAX_ATTACHMENT_SIZE = 30 * 1024 * 1024;

/**
 * Timeout for email delivery confirmation (60 seconds)
 */
const EMAIL_DELIVERY_TIMEOUT_MS = 60 * 1000;

/**
 * Type definitions for internal helper functions
 * Convex's FilterApi doesn't expose nested folder paths, so we define types explicitly
 */
type TicketHelpersFunctions = {
	getUserEmail: FunctionReference<
		'query',
		'internal',
		{ threadId: string; userId?: string },
		{ email?: string; userName?: string }
	>;
	getThreadFiles: FunctionReference<
		'query',
		'internal',
		{ threadId: string },
		Array<{ filename: string; url: string; size: number }>
	>;
	storeTicketWithPendingStatus: FunctionReference<
		'mutation',
		'internal',
		{
			threadId: string;
			ticketType: 'bug_report' | 'feature_request' | 'general_inquiry';
			title: string;
			description: string;
			userEmail: string;
			userName?: string;
			userId?: string;
			fileIds: Array<{ filename: string; url: string }>;
			toolCallId: string;
			promptMessageId: string;
		},
		Id<'supportTickets'>
	>;
	updateTicketUserEmailId: FunctionReference<
		'mutation',
		'internal',
		{ ticketId: Id<'supportTickets'>; userEmailId: string },
		null
	>;
};

/**
 * Ticket type labels for display
 */
const TICKET_TYPE_LABELS: Record<string, string> = {
	bug_report: 'Bug Report',
	feature_request: 'Feature Request',
	general_inquiry: 'General Inquiry'
};

/**
 * Get human-readable label for message role
 */
function getRoleLabel(role: string): string {
	switch (role) {
		case 'user':
			return 'User';
		case 'assistant':
			return supportAgent.options.name ?? 'AI';
		case 'tool':
			return 'Tool';
		case 'system':
			return 'System';
		default:
			return role;
	}
}

/**
 * Transcript message type (imported from ticketHelpers)
 */
type TranscriptMessage = {
	role: string;
	content: string;
	timestamp: number;
	attachments?: Array<{ filename: string; url: string }>;
};

/**
 * Build plain text email content for user confirmation
 */
function buildUserConfirmationEmail(params: {
	ticketId: string;
	threadId: string;
	ticketType: string;
	title: string;
	description: string;
}): { subject: string; text: string } {
	const { ticketId, threadId, ticketType, title, description } = params;
	const subject = `Your support ticket has been received`;
	const truncatedDescription =
		description.length > 500 ? description.slice(0, 500) + '...' : description;

	const text = `Your support ticket has been received.

Ticket ID: ${ticketId}
Thread ID: ${threadId}
Type: ${ticketType}
Title: ${title}

Description:
${truncatedDescription}

We'll review your ticket and get back to you as soon as possible.

Thank you for contacting us.`;

	return { subject, text };
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Build HTML email content for admin notification
 * Uses minimal HTML - plain text style with clickable attachment links
 */
function buildAdminNotificationEmail(params: {
	ticketId: string;
	ticketType: string;
	title: string;
	description: string;
	userName?: string;
	userEmail: string;
	fileLinks: Array<{ filename: string; url: string }>;
	threadId: string;
	transcript: TranscriptMessage[];
}): { subject: string; html: string } {
	const {
		ticketId,
		ticketType,
		title,
		description,
		userName,
		userEmail,
		fileLinks,
		threadId,
		transcript
	} = params;
	const userDisplay = userName ? `${userName} (${userEmail})` : userEmail;
	const subject = `[${ticketType}] ${title}`;

	let html = `<pre style="font-family: monospace; white-space: pre-wrap;">[${escapeHtml(ticketType)}] ${escapeHtml(title)}

Ticket ID: ${escapeHtml(ticketId)}
From: ${escapeHtml(userDisplay)}
Thread ID: ${escapeHtml(threadId)}

Description:
${escapeHtml(description)}`;

	// Add all attachments overview before transcript
	if (fileLinks.length > 0) {
		html += `

All Attachments:`;
		for (const file of fileLinks) {
			html += `
- <a href="${escapeHtml(file.url)}">${escapeHtml(file.filename)}</a>`;
		}
	}

	// Add chat transcript
	if (transcript.length > 0) {
		html += `

========== Chat Transcript ==========
`;
		for (const msg of transcript) {
			const date = new Date(msg.timestamp);
			const timeStr = date.toLocaleString('de-DE', {
				dateStyle: 'short',
				timeStyle: 'short'
			});
			const roleLabel = getRoleLabel(msg.role);

			html += `
[${escapeHtml(timeStr)}] ${escapeHtml(roleLabel)}:`;
			if (msg.content) {
				html += `
${escapeHtml(msg.content)}`;
			}

			if (msg.attachments?.length) {
				html += `
Attachments:`;
				for (const att of msg.attachments) {
					html += `
  - <a href="${escapeHtml(att.url)}">${escapeHtml(att.filename)}</a>`;
				}
			}
			html += `
`;
		}
		html += `======================================`;
	}

	html += `

This ticket was submitted via the AI customer support assistant.</pre>`;

	return { subject, html };
}

/**
 * Submit Support Ticket Action
 *
 * Main entry point for ticket submission. This action:
 * 1. Retrieves user email (from auth or thread metadata)
 * 2. Collects file attachments from the conversation
 * 3. Stores ticket in database with pending status
 * 4. Sends user confirmation email
 * 5. Schedules timeout check
 * 6. Returns processing status (success comes from webhook)
 */
export const submitTicket = internalAction({
	args: {
		threadId: v.string(),
		userId: v.optional(v.string()),
		ticketType: v.union(
			v.literal('bug_report'),
			v.literal('feature_request'),
			v.literal('general_inquiry')
		),
		title: v.string(),
		description: v.string(),
		includeAttachments: v.boolean(),
		// HITL fields for deferred tool-result (saved when webhook arrives)
		toolCallId: v.string(),
		promptMessageId: v.string(),
		// Email from form (for unauthenticated users)
		email: v.string()
	},
	handler: async (
		ctx,
		args
	): Promise<{
		status: 'error' | 'processing';
		message: string;
		ticketId?: string;
	}> => {
		// Type definitions for internal helper functions (Convex doesn't expose nested paths on internal API)
		const helpersApi = (internal.support as { ticketHelpers: TicketHelpersFunctions })
			.ticketHelpers;

		// Use email from args (submitted by user in form)
		const userEmail = args.email;

		// Try to get user name from auth
		let userName: string | undefined;
		if (args.userId) {
			const userData = await ctx.runQuery(helpersApi.getUserEmail, {
				threadId: args.threadId,
				userId: args.userId
			});
			userName = userData.userName;
		}

		// 2. Get thread files if includeAttachments
		const fileLinks: Array<{ filename: string; url: string }> = [];

		if (args.includeAttachments) {
			const files = await ctx.runQuery(helpersApi.getThreadFiles, {
				threadId: args.threadId
			});

			for (const file of files) {
				fileLinks.push({ filename: file.filename, url: file.url });
			}
		}

		// 3. Store ticket in database with pending status (includes HITL fields for deferred tool-result)
		const ticketId = await ctx.runMutation(helpersApi.storeTicketWithPendingStatus, {
			threadId: args.threadId,
			ticketType: args.ticketType,
			title: args.title,
			description: args.description,
			userEmail: userEmail,
			userName: userName,
			userId: args.userId,
			fileIds: fileLinks,
			toolCallId: args.toolCallId,
			promptMessageId: args.promptMessageId
		});

		// 4. Build and send user confirmation email
		const ticketType = TICKET_TYPE_LABELS[args.ticketType] || args.ticketType;
		const { subject: userSubject, text: userText } = buildUserConfirmationEmail({
			ticketId: ticketId.toString(),
			threadId: args.threadId,
			ticketType,
			title: args.title,
			description: args.description
		});

		const resendClient = new Resend(process.env.RESEND_API_KEY);
		const fromEmail = process.env.AUTH_EMAIL;

		if (!fromEmail) {
			// Mark ticket as failed
			await ctx.runMutation(internal.support.ticketHelpers.updateTicketEmailStatus, {
				ticketId,
				status: 'failed',
				error: 'Email configuration missing. Please contact support.'
			});
			return {
				status: 'error',
				message: 'Email configuration missing. Please contact support.'
			};
		}

		let userEmailId: string | undefined;

		try {
			userEmailId = await resendComponent.sendEmailManually(
				ctx,
				{
					from: fromEmail,
					to: userEmail,
					subject: userSubject
				},
				async (idempotencyKey) => {
					const { data, error } = await resendClient.emails.send({
						from: fromEmail,
						to: [userEmail],
						subject: userSubject,
						text: userText,
						headers: {
							'X-Idempotency-Key': idempotencyKey
						}
					});

					if (error) {
						throw new Error(error.message);
					}

					return data?.id || idempotencyKey;
				}
			);
		} catch (error) {
			console.error('Failed to send user confirmation email:', error);
			// Mark ticket as failed
			await ctx.runMutation(internal.support.ticketHelpers.updateTicketEmailStatus, {
				ticketId,
				status: 'failed',
				error: 'Failed to send confirmation email. Please try again.'
			});
			return {
				status: 'error',
				message: 'Failed to send confirmation email. Please try again.'
			};
		}

		// 5. Update ticket with userEmailId
		await ctx.runMutation(helpersApi.updateTicketUserEmailId, {
			ticketId,
			userEmailId
		});

		// 6. Schedule timeout check
		// Note: checkEmailDeliveryTimeout is in ticketHelpers.ts because this file uses 'use node'
		await ctx.scheduler.runAfter(
			EMAIL_DELIVERY_TIMEOUT_MS,
			internal.support.ticketHelpers.checkEmailDeliveryTimeout,
			{ ticketId }
		);

		// Return processing status - actual success will come from webhook
		return {
			status: 'processing',
			ticketId: ticketId.toString(),
			message: 'Submitting your ticket...'
		};
	}
});

/**
 * Send Admin Notification Email
 *
 * Called when user confirmation email is delivered (via webhook handler).
 * Sends the notification to the admin/support email.
 */
export const sendAdminNotificationEmail = internalAction({
	args: {
		ticketId: v.id('supportTickets')
	},
	handler: async (ctx, args) => {
		// Get ticket details (getTicketById is in ticketHelpers.ts because this file uses 'use node')
		const ticket = await ctx.runQuery(internal.support.ticketHelpers.getTicketById, {
			ticketId: args.ticketId
		});

		if (!ticket) {
			console.error('Ticket not found for admin notification:', args.ticketId);
			return { status: 'error', message: 'Ticket not found' };
		}

		// Check if already delivered or failed
		if (ticket.emailDeliveryStatus !== 'pending') {
			console.log('Ticket email delivery already finalized:', ticket.emailDeliveryStatus);
			return { status: 'skipped', message: 'Already processed' };
		}

		const ticketType = TICKET_TYPE_LABELS[ticket.ticketType] || ticket.ticketType;

		// Get file links from fileIds (already contains { filename, url } objects)
		const fileLinks = ticket.fileIds || [];

		// Get chat transcript for the thread
		const transcript = await ctx.runQuery(internal.support.ticketHelpers.getThreadTranscript, {
			threadId: ticket.threadId
		});

		const { subject, html } = buildAdminNotificationEmail({
			ticketId: args.ticketId.toString(),
			ticketType,
			title: ticket.title,
			description: ticket.description,
			userName: ticket.userName,
			userEmail: ticket.userEmail,
			fileLinks,
			threadId: ticket.threadId,
			transcript
		});

		const resendClient = new Resend(process.env.RESEND_API_KEY);
		const supportEmail = process.env.SUPPORT_EMAIL || process.env.AUTH_EMAIL;
		const fromEmail = process.env.AUTH_EMAIL;

		if (!supportEmail || !fromEmail) {
			await ctx.runMutation(internal.support.ticketHelpers.updateTicketEmailStatus, {
				ticketId: args.ticketId,
				status: 'failed',
				error: 'Admin email configuration missing.'
			});
			return { status: 'error', message: 'Email configuration missing' };
		}

		// Prepare attachments if within size limit
		const attachments: Array<{ filename: string; path: string }> = [];
		let totalSize = 0;

		for (const file of fileLinks) {
			const estimatedSize = 1024 * 1024; // Assume 1MB per file
			if (totalSize + estimatedSize <= MAX_ATTACHMENT_SIZE) {
				attachments.push({ filename: file.filename, path: file.url });
				totalSize += estimatedSize;
			}
		}

		let adminEmailId: string | undefined;

		try {
			adminEmailId = await resendComponent.sendEmailManually(
				ctx,
				{
					from: fromEmail,
					to: supportEmail,
					subject
				},
				async (idempotencyKey) => {
					const { data, error } = await resendClient.emails.send({
						from: fromEmail,
						to: [supportEmail],
						replyTo: ticket.userEmail,
						subject,
						html,
						attachments: attachments.length > 0 ? attachments : undefined,
						headers: {
							'X-Idempotency-Key': idempotencyKey
						}
					});

					if (error) {
						throw new Error(error.message);
					}

					return data?.id || idempotencyKey;
				}
			);
		} catch (error) {
			console.error('Failed to send admin notification email:', error);
			await ctx.runMutation(internal.support.ticketHelpers.updateTicketEmailStatus, {
				ticketId: args.ticketId,
				status: 'failed',
				error:
					'Failed to send admin notification. Your ticket was received but admin was not notified.'
			});
			return { status: 'error', message: 'Failed to send admin notification' };
		}

		// Update ticket with adminEmailId
		await ctx.runMutation(internal.support.ticketHelpers.updateTicketAdminEmailId, {
			ticketId: args.ticketId,
			adminEmailId
		});

		return { status: 'success', adminEmailId };
	}
});
