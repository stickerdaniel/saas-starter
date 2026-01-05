/**
 * Email Template Rendering Utilities
 *
 * Renders pre-built email templates with dynamic data using simple {{var}} interpolation.
 * Templates are generated at build-time from Svelte components.
 */

import type {
	VerificationEmailData,
	PasswordResetEmailData,
	AdminReplyNotificationEmailData,
	RenderedEmail
} from '../../emails/templates/types';
import {
	VERIFICATION_HTML,
	VERIFICATION_TEXT,
	PASSWORDRESET_HTML,
	PASSWORDRESET_TEXT,
	ADMINREPLYNOTIFICATION_HTML,
	ADMINREPLYNOTIFICATION_TEXT
} from './generated/index.js';

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
 * Get base URL from environment at runtime
 */
function getBaseUrl(): string {
	return process.env.APP_URL || 'https://example.com';
}

/**
 * Render verification email with OTP code
 * @param code - 8-digit verification code
 * @param expiryMinutes - Minutes until code expires
 * @returns Rendered HTML and plain text email
 */
export function renderVerificationEmail(
	code: VerificationEmailData['code'],
	expiryMinutes: VerificationEmailData['expiryMinutes']
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const data = {
		code: escapeHtml(code),
		expiryMinutes: expiryMinutes,
		baseUrl: escapeHtml(baseUrl)
	};
	const textData = { code, expiryMinutes, baseUrl };

	return {
		html: renderTemplate(VERIFICATION_HTML, data),
		text: renderTemplate(VERIFICATION_TEXT, textData)
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
