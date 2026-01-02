import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { resend } from './resend';

/**
 * Send verification email with OTP code
 *
 * Simple email sending using inline text (matching Resend component docs).
 * For more complex templates, we'll integrate svelte-email in the future.
 */
export const sendVerificationEmail = internalMutation({
	args: {
		email: v.string(),
		code: v.string(),
		expiryMinutes: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { email, code, expiryMinutes = 20 } = args;

		await resend.sendEmail(ctx, {
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: email,
			subject: 'Verify your email',
			text: `Your verification code is: ${code}

This code will expire in ${expiryMinutes} minutes or if you request a new verification code.

If you didn't request this code, please ignore this email.`
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
 * Includes a preview of the admin's message and a link to view the conversation.
 */
export const sendAdminReplyNotification = internalMutation({
	args: {
		email: v.string(),
		adminName: v.string(),
		messagePreview: v.string()
	},
	handler: async (ctx, args) => {
		const { email, adminName, messagePreview } = args;
		const appUrl = process.env.APP_URL || 'http://localhost:5173';

		await resend.sendEmail(ctx, {
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: email,
			subject: 'New reply to your support request',
			text: `${adminName} has replied to your support request:

"${messagePreview}"

Click here to view the conversation and respond:
${appUrl}

---
You're receiving this email because you requested notifications for this support thread.`
		});
	}
});
