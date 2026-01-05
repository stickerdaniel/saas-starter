import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { resend } from './resend';

/**
 * Send verification email with verification link
 *
 * Simple email sending using inline text (matching Resend component docs).
 * For more complex templates, we'll integrate svelte-email in the future.
 */
export const sendVerificationEmail = internalMutation({
	args: {
		email: v.string(),
		verificationUrl: v.string(),
		expiryMinutes: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { email, verificationUrl, expiryMinutes = 20 } = args;

		await resend.sendEmail(ctx, {
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: email,
			subject: 'Verify your email',
			text: `Click the link below to verify your email address:

${verificationUrl}

This link will expire in ${expiryMinutes} minutes.

If you didn't request this, please ignore this email.`
		});
	}
});

/**
 * Send password reset email with reset link
 */
export const sendResetPasswordEmail = internalMutation({
	args: {
		email: v.string(),
		resetUrl: v.string(),
		userName: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { email, resetUrl, userName } = args;
		const greeting = userName ? `Hello ${userName}` : 'Hello';

		await resend.sendEmail(ctx, {
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: email,
			subject: 'Reset your password',
			text: `${greeting},

We received a request to reset your password. Click the link below to set a new password:

${resetUrl}

If you didn't request this, you can safely ignore this email.`
		});
	}
});

/**
 * Send notification email when admin replies to a support thread
 *
 * Called when an admin responds to a user's support request.
 * Includes a preview of the admin's message and a deep link to view the conversation.
 */
export const sendAdminReplyNotification = internalMutation({
	args: {
		email: v.string(),
		adminName: v.string(),
		messagePreview: v.string(),
		threadId: v.string(),
		pageUrl: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { email, adminName, messagePreview, threadId, pageUrl } = args;
		const appUrl = process.env.APP_URL || 'http://localhost:5173';

		// Build deep link that opens the support widget to this thread
		// Strip any existing support/thread params to avoid duplicates
		const url = new URL(pageUrl || appUrl);
		url.searchParams.delete('support');
		url.searchParams.delete('thread');
		url.searchParams.set('support', 'open');
		url.searchParams.set('thread', threadId);
		const deepLink = url.toString();

		await resend.sendEmail(ctx, {
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: email,
			subject: 'New reply to your support request',
			text: `${adminName} has replied to your support request:

"${messagePreview}"

Click here to view and respond:
${deepLink}

---
You're receiving this email because you requested notifications for this support thread.`
		});
	}
});
