/**
 * Email Template Rendering Utilities
 *
 * Renders pre-built email templates with dynamic data using simple {{var}} interpolation.
 * Templates are generated at build-time from Svelte components.
 */

import type {
	VerificationEmailData,
	VerificationCodeEmailData,
	PasswordResetEmailData,
	AdminReplyNotificationEmailData,
	NewTicketAdminNotificationEmailData,
	NewUserSignupNotificationEmailData,
	RenderedEmail
} from '../../emails/templates/types';
import {
	VERIFICATION_HTML,
	VERIFICATION_TEXT,
	VERIFICATIONCODE_HTML,
	VERIFICATIONCODE_TEXT,
	PASSWORDRESET_HTML,
	PASSWORDRESET_TEXT,
	ADMINREPLYNOTIFICATION_HTML,
	ADMINREPLYNOTIFICATION_TEXT,
	NEWTICKETADMINNOTIFICATION_HTML,
	NEWTICKETADMINNOTIFICATION_TEXT,
	NEWUSERSIGNUPNOTIFICATION_HTML,
	NEWUSERSIGNUPNOTIFICATION_TEXT
} from './_generated/index.js';
import { getEmailAssetUrl } from '../env';

/**
 * Simple template renderer that replaces {{varName}} patterns with values.
 * Compatible with Convex runtime (no Node.js dependencies).
 */
function renderTemplate(template: string, data: Record<string, string | number>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
		const value = data[key];
		return value !== undefined ? String(value) : '';
	});
}

/**
 * Escape HTML special characters for safe rendering in HTML context
 */
function escapeHtml(str: string): string {
	return str.replace(
		/[&<>"']/g,
		(c) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;'
			})[c]!
	);
}

/**
 * Get base URL for email assets (images, footer links)
 * Always uses production URL so images load in email clients
 */
function getBaseUrl(): string {
	return getEmailAssetUrl();
}

/**
 * Render verification email with magic link
 * @param verificationUrl - URL to verify email
 * @param expiryMinutes - Minutes until link expires
 * @returns Rendered HTML and plain text email
 */
export function renderVerificationEmail(
	verificationUrl: VerificationEmailData['verificationUrl'],
	expiryMinutes: VerificationEmailData['expiryMinutes']
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const data = {
		verificationUrl: escapeHtml(verificationUrl),
		expiryMinutes: expiryMinutes,
		baseUrl: escapeHtml(baseUrl)
	};
	const textData = { verificationUrl, expiryMinutes, baseUrl };

	return {
		html: renderTemplate(VERIFICATION_HTML, data),
		text: renderTemplate(VERIFICATION_TEXT, textData)
	};
}

/**
 * Render verification code email with OTP code
 *
 * NOTE: Not currently in use. Kept for future OTP-based verification.
 * Add a corresponding mutation in send.ts when needed.
 *
 * @param code - 8-digit verification code
 * @param expiryMinutes - Minutes until code expires
 * @returns Rendered HTML and plain text email
 */
export function renderVerificationCodeEmail(
	code: VerificationCodeEmailData['code'],
	expiryMinutes: VerificationCodeEmailData['expiryMinutes']
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const data = {
		code: escapeHtml(code),
		expiryMinutes: expiryMinutes,
		baseUrl: escapeHtml(baseUrl)
	};
	const textData = { code, expiryMinutes, baseUrl };

	return {
		html: renderTemplate(VERIFICATIONCODE_HTML, data),
		text: renderTemplate(VERIFICATIONCODE_TEXT, textData)
	};
}

/**
 * Render password reset email with reset link
 * @param resetUrl - URL to reset password page with token
 * @param userName - User's name for personalization (optional, defaults to "there")
 * @returns Rendered HTML and plain text email
 */
export function renderPasswordResetEmail(
	resetUrl: PasswordResetEmailData['resetUrl'],
	userName?: PasswordResetEmailData['userName']
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const data = {
		resetUrl: escapeHtml(resetUrl),
		userName: userName ? escapeHtml(userName) : 'there',
		baseUrl: escapeHtml(baseUrl)
	};
	const textData = {
		resetUrl,
		userName: userName || 'there',
		baseUrl
	};

	return {
		html: renderTemplate(PASSWORDRESET_HTML, data),
		text: renderTemplate(PASSWORDRESET_TEXT, textData)
	};
}

/**
 * Render admin reply notification email
 * @param adminName - Name of the admin who replied
 * @param messagePreview - Preview text of the admin's message
 * @param deepLink - URL to view the full conversation
 * @returns Rendered HTML and plain text email
 */
export function renderAdminReplyNotificationEmail(
	adminName: AdminReplyNotificationEmailData['adminName'],
	messagePreview: AdminReplyNotificationEmailData['messagePreview'],
	deepLink: AdminReplyNotificationEmailData['deepLink']
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const data = {
		adminName: escapeHtml(adminName),
		messagePreview: escapeHtml(messagePreview),
		deepLink: escapeHtml(deepLink),
		baseUrl: escapeHtml(baseUrl)
	};
	const textData = { adminName, messagePreview, deepLink, baseUrl };

	return {
		html: renderTemplate(ADMINREPLYNOTIFICATION_HTML, data),
		text: renderTemplate(ADMINREPLYNOTIFICATION_TEXT, textData)
	};
}

/**
 * Render new ticket admin notification email
 *
 * Sent to admins when:
 * - User clicks "Talk to human" (handoff from AI)
 * - User sends message to a handed-off ticket
 * - User reopens a closed ticket
 *
 * @param data - Email data including isReopen, user info, messages, and admin dashboard link
 * @returns Rendered HTML and plain text email
 */
export function renderNewTicketAdminNotificationEmail(
	data: NewTicketAdminNotificationEmailData
): RenderedEmail {
	const baseUrl = getBaseUrl();

	// Compute text values based on isReopen flag
	const titleText = data.isReopen ? 'Support ticket reopened' : 'New support ticket';
	const descriptionText = data.isReopen
		? `${data.userName} has sent a new message to a previously closed ticket`
		: `${data.userName} has started a new support conversation`;
	const previewText = data.isReopen
		? `${data.userName} has reopened a support ticket`
		: `New support ticket from ${data.userName}`;

	// Build HTML for messages (only show timestamp for first message)
	const messagesHtml = data.messages
		.map(
			(m, index) => `
		<div style="background-color: #f4f4f5; border-radius: 6px; padding: 12px; margin-bottom: 8px;">
			${index === 0 ? `<span style="display: block; font-size: 12px; color: #71717a; margin-bottom: 4px;">${escapeHtml(m.timestamp)}</span>` : ''}
			<span style="font-size: 14px; color: #18181b;">${escapeHtml(m.text)}</span>
		</div>
	`
		)
		.join('');

	const templateData = {
		titleText: escapeHtml(titleText),
		descriptionText: escapeHtml(descriptionText),
		previewText: escapeHtml(previewText),
		messagesHtml: messagesHtml || '<p style="color: #71717a;">No messages</p>',
		adminDashboardLink: escapeHtml(data.adminDashboardLink),
		baseUrl: escapeHtml(baseUrl)
	};

	// For plain text version (only show timestamp for first message)
	const messagesText = data.messages
		.map((m, index) => (index === 0 ? `[${m.timestamp}] ${m.text}` : m.text))
		.join('\n\n');
	const textData = {
		titleText,
		descriptionText,
		previewText,
		messagesHtml: messagesText || 'No messages',
		adminDashboardLink: data.adminDashboardLink,
		baseUrl
	};

	return {
		html: renderTemplate(NEWTICKETADMINNOTIFICATION_HTML, templateData),
		text: renderTemplate(NEWTICKETADMINNOTIFICATION_TEXT, textData)
	};
}

/**
 * Render new user signup notification email
 *
 * Sent to admins when a new user registers on the platform.
 *
 * @param data - Email data including user info and admin dashboard link
 * @returns Rendered HTML and plain text email
 */
export function renderNewUserSignupNotificationEmail(
	data: NewUserSignupNotificationEmailData
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const templateData = {
		userName: escapeHtml(data.userName || 'New User'),
		userEmail: escapeHtml(data.userEmail),
		signupMethod: escapeHtml(data.signupMethod),
		signupTime: escapeHtml(data.signupTime),
		adminDashboardLink: escapeHtml(data.adminDashboardLink),
		baseUrl: escapeHtml(baseUrl)
	};

	const textData = {
		userName: data.userName || 'New User',
		userEmail: data.userEmail,
		signupMethod: data.signupMethod,
		signupTime: data.signupTime,
		adminDashboardLink: data.adminDashboardLink,
		baseUrl
	};

	return {
		html: renderTemplate(NEWUSERSIGNUPNOTIFICATION_HTML, templateData),
		text: renderTemplate(NEWUSERSIGNUPNOTIFICATION_TEXT, textData)
	};
}
