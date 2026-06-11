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
import { requireEnv } from '../env';
import { t, DEFAULT_LOCALE } from '../i18n/translations';

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
 * Uses EMAIL_ASSET_URL env var - should point to publicly accessible URL
 */
function getBaseUrl(): string {
	return requireEnv('EMAIL_ASSET_URL', { feature: 'email asset URLs (logo, etc.)' });
}

/**
 * Render verification email with magic link
 * @param verificationUrl - URL to verify email
 * @param expiryMinutes - Minutes until link expires
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @returns Rendered HTML and plain text email
 */
export function renderVerificationEmail(
	verificationUrl: VerificationEmailData['verificationUrl'],
	expiryMinutes: VerificationEmailData['expiryMinutes'],
	locale: string = DEFAULT_LOCALE
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const texts = {
		badgeText: t(locale, 'email.badge.auth'),
		titleText: t(locale, 'email.verification.title'),
		descriptionText: t(locale, 'email.verification.description'),
		previewText: t(locale, 'email.verification.preview'),
		introText: t(locale, 'email.verification.intro'),
		buttonText: t(locale, 'email.verification.button'),
		expiryText: t(locale, 'email.verification.expiry', { expiryMinutes }),
		disclaimerText: t(locale, 'email.verification.disclaimer')
	};

	const data = {
		verificationUrl: escapeHtml(verificationUrl),
		baseUrl: escapeHtml(baseUrl),
		...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, escapeHtml(v)]))
	};
	const textData = { verificationUrl, baseUrl, ...texts };

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
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @returns Rendered HTML and plain text email
 */
export function renderVerificationCodeEmail(
	code: VerificationCodeEmailData['code'],
	expiryMinutes: VerificationCodeEmailData['expiryMinutes'],
	locale: string = DEFAULT_LOCALE
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const texts = {
		badgeText: t(locale, 'email.badge.auth'),
		titleText: t(locale, 'email.verification_code.title'),
		descriptionText: t(locale, 'email.verification_code.description'),
		previewText: t(locale, 'email.verification_code.preview', { code }),
		expiryText: t(locale, 'email.verification_code.expiry', { expiryMinutes }),
		disclaimerText: t(locale, 'email.verification_code.disclaimer')
	};

	const data = {
		code: escapeHtml(code),
		baseUrl: escapeHtml(baseUrl),
		...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, escapeHtml(v)]))
	};
	const textData = { code, baseUrl, ...texts };

	return {
		html: renderTemplate(VERIFICATIONCODE_HTML, data),
		text: renderTemplate(VERIFICATIONCODE_TEXT, textData)
	};
}

/**
 * Render password reset email with reset link
 * @param resetUrl - URL to reset password page with token
 * @param userName - User's name for personalization (optional, falls back to a generic greeting)
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @returns Rendered HTML and plain text email
 */
export function renderPasswordResetEmail(
	resetUrl: PasswordResetEmailData['resetUrl'],
	userName?: PasswordResetEmailData['userName'],
	locale: string = DEFAULT_LOCALE
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const texts = {
		badgeText: t(locale, 'email.badge.auth'),
		titleText: t(locale, 'email.reset_password.title'),
		greetingText: userName
			? t(locale, 'email.reset_password.greeting', { userName })
			: t(locale, 'email.reset_password.greeting_fallback'),
		previewText: t(locale, 'email.reset_password.preview'),
		bodyText: t(locale, 'email.reset_password.body'),
		buttonText: t(locale, 'email.reset_password.button'),
		expiryText: t(locale, 'email.reset_password.expiry'),
		disclaimerText: t(locale, 'email.reset_password.disclaimer')
	};

	const data = {
		resetUrl: escapeHtml(resetUrl),
		baseUrl: escapeHtml(baseUrl),
		...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, escapeHtml(v)]))
	};
	const textData = { resetUrl, baseUrl, ...texts };

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
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @returns Rendered HTML and plain text email
 */
export function renderAdminReplyNotificationEmail(
	adminName: AdminReplyNotificationEmailData['adminName'],
	messagePreview: AdminReplyNotificationEmailData['messagePreview'],
	deepLink: AdminReplyNotificationEmailData['deepLink'],
	locale: string = DEFAULT_LOCALE
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const texts = {
		badgeText: t(locale, 'email.badge.support'),
		titleText: t(locale, 'email.admin_reply.title'),
		descriptionText: t(locale, 'email.admin_reply.description', { adminName }),
		previewText: t(locale, 'email.admin_reply.preview', { adminName }),
		buttonText: t(locale, 'email.admin_reply.button'),
		footerText: t(locale, 'email.admin_reply.footer')
	};

	const data = {
		messagePreview: escapeHtml(messagePreview),
		deepLink: escapeHtml(deepLink),
		baseUrl: escapeHtml(baseUrl),
		...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, escapeHtml(v)]))
	};
	const textData = { messagePreview, deepLink, baseUrl, ...texts };

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
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @returns Rendered HTML and plain text email
 */
export function renderNewTicketAdminNotificationEmail(
	data: NewTicketAdminNotificationEmailData,
	locale: string = DEFAULT_LOCALE
): RenderedEmail {
	const baseUrl = getBaseUrl();

	// Compute text values based on isReopen flag using translations
	const titleText = data.isReopen
		? t(locale, 'email.body.ticket_reopened')
		: t(locale, 'email.body.ticket_new');
	const descriptionText = data.isReopen
		? t(locale, 'email.body.ticket_message', { userName: data.userName })
		: t(locale, 'email.body.ticket_started', { userName: data.userName });
	const previewText = data.isReopen
		? t(locale, 'email.subject.ticket_reopened', { userName: data.userName })
		: t(locale, 'email.subject.ticket_new', { userName: data.userName });

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

	const noMessagesText = t(locale, 'email.body.no_messages');
	const badgeText = t(locale, 'email.badge.support');
	const buttonText = t(locale, 'email.body.view_admin_dashboard');
	const footerText = t(locale, 'email.body.ticket_footer');
	const templateData = {
		titleText: escapeHtml(titleText),
		descriptionText: escapeHtml(descriptionText),
		previewText: escapeHtml(previewText),
		messagesHtml: messagesHtml || `<p style="color: #71717a;">${escapeHtml(noMessagesText)}</p>`,
		adminDashboardLink: escapeHtml(data.adminDashboardLink),
		baseUrl: escapeHtml(baseUrl),
		badgeText: escapeHtml(badgeText),
		buttonText: escapeHtml(buttonText),
		footerText: escapeHtml(footerText)
	};

	// For plain text version (only show timestamp for first message)
	const messagesText = data.messages
		.map((m, index) => (index === 0 ? `[${m.timestamp}] ${m.text}` : m.text))
		.join('\n\n');
	const textData = {
		titleText,
		descriptionText,
		previewText,
		messagesHtml: messagesText || noMessagesText,
		adminDashboardLink: data.adminDashboardLink,
		baseUrl,
		badgeText,
		buttonText,
		footerText
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
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @returns Rendered HTML and plain text email
 */
export function renderNewUserSignupNotificationEmail(
	data: NewUserSignupNotificationEmailData,
	locale: string = DEFAULT_LOCALE
): RenderedEmail {
	const baseUrl = getBaseUrl();

	const texts = {
		badgeText: t(locale, 'email.badge.stats'),
		titleText: t(locale, 'email.new_signup.title'),
		descriptionText: t(locale, 'email.new_signup.description'),
		previewText: t(locale, 'email.new_signup.preview', { userEmail: data.userEmail }),
		nameLabel: t(locale, 'email.new_signup.label_name'),
		emailLabel: t(locale, 'email.new_signup.label_email'),
		methodLabel: t(locale, 'email.new_signup.label_method'),
		timeLabel: t(locale, 'email.new_signup.label_time'),
		buttonText: t(locale, 'email.body.view_admin_dashboard'),
		footerText: t(locale, 'email.new_signup.footer')
	};

	const templateData = {
		userName: escapeHtml(data.userName || 'New User'),
		userEmail: escapeHtml(data.userEmail),
		signupMethod: escapeHtml(data.signupMethod),
		signupTime: escapeHtml(data.signupTime),
		adminDashboardLink: escapeHtml(data.adminDashboardLink),
		baseUrl: escapeHtml(baseUrl),
		...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, escapeHtml(v)]))
	};

	const textData = {
		userName: data.userName || 'New User',
		userEmail: data.userEmail,
		signupMethod: data.signupMethod,
		signupTime: data.signupTime,
		adminDashboardLink: data.adminDashboardLink,
		baseUrl,
		...texts
	};

	return {
		html: renderTemplate(NEWUSERSIGNUPNOTIFICATION_HTML, templateData),
		text: renderTemplate(NEWUSERSIGNUPNOTIFICATION_TEXT, textData)
	};
}
