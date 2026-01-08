import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { resend } from './resend';
import {
	renderVerificationEmail,
	renderPasswordResetEmail,
	renderAdminReplyNotificationEmail
} from './templates';

/**
 * Send verification email with verification link
 *
 * Uses pre-rendered HTML templates with template placeholders for dynamic content.
 */
export const sendVerificationEmail = internalMutation({
	args: {
		email: v.string(),
		verificationUrl: v.string(),
		expiryMinutes: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { email, verificationUrl, expiryMinutes = 20 } = args;
		const { html, text } = renderVerificationEmail(verificationUrl, expiryMinutes);

		await resend.sendEmail(ctx, {
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: email,
			subject: 'Verify your email',
			html,
			text,
			// Analytics tracking via custom headers
			headers: [
				{ name: 'X-Email-Category', value: 'authentication' },
				{ name: 'X-Email-Template', value: 'verification' }
			]
		});
	}
});

/**
 * Send password reset email with reset link
 *
 * Uses pre-rendered HTML templates with Eta placeholders for dynamic content.
 */
export const sendResetPasswordEmail = internalMutation({
	args: {
		email: v.string(),
		resetUrl: v.string(),
		userName: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { email, resetUrl, userName } = args;
		const { html, text } = renderPasswordResetEmail(resetUrl, userName);

		await resend.sendEmail(ctx, {
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: email,
			subject: 'Reset your password',
			html,
			text,
			// Analytics tracking via custom headers
			headers: [
				{ name: 'X-Email-Category', value: 'authentication' },
				{ name: 'X-Email-Template', value: 'password-reset' }
			]
		});
	}
});

/**
 * Send notification email when admin replies to a support thread
 *
 * Called when an admin responds to a user's support request.
 * Uses pre-rendered HTML templates with Eta placeholders for dynamic content.
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

		const { html, text } = renderAdminReplyNotificationEmail(adminName, messagePreview, deepLink);

		await resend.sendEmail(ctx, {
			from: process.env.AUTH_EMAIL || 'noreply@example.com',
			to: email,
			subject: 'New reply to your support request',
			html,
			text,
			// Analytics tracking via custom headers
			headers: [
				{ name: 'X-Email-Category', value: 'support' },
				{ name: 'X-Email-Template', value: 'admin-reply' },
				{ name: 'X-Thread-ID', value: threadId }
			]
		});
	}
});
