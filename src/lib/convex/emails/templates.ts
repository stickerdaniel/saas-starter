/**
 * Email Template Rendering Utilities
 *
 * Uses Eta templating to render pre-built email templates with dynamic data.
 * Templates are generated at build-time from Svelte components.
 */

import { Eta } from 'eta';
import type {
	VerificationEmailData,
	PasswordResetEmailData,
	AdminReplyNotificationEmailData,
	RenderedEmail
} from '$lib/emails/templates/types';
import {
	VERIFICATION_HTML,
	VERIFICATION_TEXT,
	PASSWORDRESET_HTML,
	PASSWORDRESET_TEXT,
	ADMINREPLYNOTIFICATION_HTML,
	ADMINREPLYNOTIFICATION_TEXT
} from './generated/index.js';

const eta = new Eta();

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
		html: eta.renderString(VERIFICATION_HTML, data),
		text: eta.renderString(VERIFICATION_TEXT, textData)
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
		html: eta.renderString(PASSWORDRESET_HTML, data),
		text: eta.renderString(PASSWORDRESET_TEXT, textData)
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
		html: eta.renderString(ADMINREPLYNOTIFICATION_HTML, data),
		text: eta.renderString(ADMINREPLYNOTIFICATION_TEXT, textData)
	};
}
