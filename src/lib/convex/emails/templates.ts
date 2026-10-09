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
	NewCustomerAdminNotificationEmailData,
	SupportRateLimitAlertEmailData,
	RenderedEmail
} from '../../emails/templates/types';
import type { ComposedJourney } from '../admin/customerNotifications/compose';
import { buildJourneyTimeline, type RailRole } from './journeyTimeline';
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
	NEWUSERSIGNUPNOTIFICATION_TEXT,
	NEWCUSTOMERADMINNOTIFICATION_HTML,
	NEWCUSTOMERADMINNOTIFICATION_TEXT,
	SUPPORTRATELIMITALERT_HTML,
	SUPPORTRATELIMITALERT_TEXT
} from '../../emails/generated/index.js';
import { requireEmailConfiguration } from '../env';
import { t, DEFAULT_LOCALE, getValidLocale } from '../i18n/translations';
import { escapeHtml } from './html';

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

/** Get the validated base URL for email assets and footer links. */
function getBaseUrl(): string {
	return requireEmailConfiguration().assetUrl;
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
		lang: getValidLocale(locale),
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
		lang: getValidLocale(locale),
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
 * Renders the reset mail, or the first-password variant of it.
 *
 * Better Auth sends this mail for an account that signed up through an OAuth
 * provider too, and its link works: `resetPassword` creates the missing
 * credential account. The reset wording does not, because there is no password
 * to reset and none that "will remain unchanged" if the mail was not expected.
 * The template takes every string as a prop, so only the key prefix changes.
 *
 * @param resetUrl - URL to reset password page with token
 * @param userName - User's name for personalization (optional, falls back to a generic greeting)
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @param hasPassword - Whether the account has a password to reset today
 * @returns Rendered HTML and plain text email
 */
export function renderPasswordResetEmail(
	resetUrl: PasswordResetEmailData['resetUrl'],
	userName?: PasswordResetEmailData['userName'],
	locale: string = DEFAULT_LOCALE,
	hasPassword: boolean = true
): RenderedEmail {
	const baseUrl = getBaseUrl();
	// Spelled out rather than composed from a prefix, so the orphan-key check can
	// see that both sets are used.
	const keys = hasPassword
		? {
				title: 'email.reset_password.title',
				greeting: 'email.reset_password.greeting',
				greetingFallback: 'email.reset_password.greeting_fallback',
				preview: 'email.reset_password.preview',
				body: 'email.reset_password.body',
				button: 'email.reset_password.button',
				expiry: 'email.reset_password.expiry',
				disclaimer: 'email.reset_password.disclaimer'
			}
		: {
				title: 'email.set_password.title',
				greeting: 'email.set_password.greeting',
				greetingFallback: 'email.set_password.greeting_fallback',
				preview: 'email.set_password.preview',
				body: 'email.set_password.body',
				button: 'email.set_password.button',
				expiry: 'email.set_password.expiry',
				disclaimer: 'email.set_password.disclaimer'
			};

	const texts = {
		badgeText: t(locale, 'email.badge.auth'),
		titleText: t(locale, keys.title),
		greetingText: userName
			? t(locale, keys.greeting, { userName })
			: t(locale, keys.greetingFallback),
		previewText: t(locale, keys.preview),
		bodyText: t(locale, keys.body),
		buttonText: t(locale, keys.button),
		expiryText: t(locale, keys.expiry),
		disclaimerText: t(locale, keys.disclaimer)
	};

	const data = {
		lang: getValidLocale(locale),
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
		replyHintText: t(locale, 'email.admin_reply.reply_hint'),
		footerText: t(locale, 'email.admin_reply.footer')
	};

	const data = {
		lang: getValidLocale(locale),
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

	// A bare "Talk to a human" carries no message excerpts, so its empty-state line
	// names the handoff. Every other empty case (a reopen or reply with no text)
	// keeps the neutral wording shared with the rest of the admin ticket email.
	const noMessagesText = t(
		locale,
		data.isBareHandoff ? 'email.body.handoff_no_messages' : 'email.body.no_messages'
	);
	const badgeText = t(locale, 'email.badge.support');
	const buttonText = t(locale, 'email.body.view_admin_dashboard');
	const footerText = t(locale, 'email.body.ticket_footer');
	const templateData = {
		lang: getValidLocale(locale),
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
		lang: getValidLocale(locale),
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

/** ` class="…" style="…"` for a theme role painted as `property`. */
function paintRole(role: RailRole, property: string, style: string): string {
	const className = role.darkClass ? ` class="${escapeHtml(role.darkClass)}"` : '';
	return `${className} style="${escapeHtml(`${style};${property}:${role.color}`)}"`;
}

/**
 * The summary tiles as one table row of equal columns, styled like the
 * template's bordered boxes, with a plain-text line per tile.
 */
function renderTiles({ tiles, theme }: ComposedJourney): { html: string; text: string } {
	if (tiles.length === 0) return { html: '', text: '' };
	const width = `${(100 / tiles.length).toFixed(4)}%`;
	const cells = tiles.map((tile, index) => {
		const padding = [
			index > 0 ? 'padding-left:4px' : '',
			index < tiles.length - 1 ? 'padding-right:4px' : ''
		]
			.filter(Boolean)
			.join(';');
		const box = paintRole(
			theme.tiles.border,
			'border-color',
			'border-width:1px;border-style:solid;border-radius:6px;padding:12px'
		);
		return [
			`<td valign="top" style="${escapeHtml(`width:${width};vertical-align:top${padding ? `;${padding}` : ''}`)}">`,
			`<div${box}>`,
			`<p style="margin:0;font-size:18px;line-height:1.25;font-weight:600">${escapeHtml(tile.value)}</p>`,
			`<p${paintRole(theme.tiles.label, 'color', 'margin:4px 0 0;font-size:12px;line-height:16px')}>${escapeHtml(tile.label)}</p>`,
			'</div></td>'
		].join('');
	});
	return {
		html: `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:24px;border-collapse:collapse"><tbody><tr>${cells.join('')}</tr></tbody></table>`,
		text: tiles.map((tile) => `${tile.value}: ${tile.label}`).join('\n')
	};
}

/**
 * Render the new customer admin notification email
 *
 * Sent to admins when a customer's first eligible payment is observed. The
 * journey (tiles, the rail and its coverage notes) fills one placeholder;
 * without a journey that placeholder holds a short "unavailable" note.
 *
 * @param data - The customer, their first payment and the composed journey
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @returns Subject, rendered HTML and plain text email
 */
export function renderNewCustomerAdminNotificationEmail(
	data: NewCustomerAdminNotificationEmailData,
	locale: string = DEFAULT_LOCALE
): RenderedEmail & { subject: string } {
	const baseUrl = getBaseUrl();
	const lang = getValidLocale(locale);
	const { customer, amount, journey } = data;

	const texts = {
		badgeText: t(locale, 'email.new_customer.badge'),
		titleText: t(locale, 'email.new_customer.title', { customer, amount }),
		descriptionText: data.customerEmail,
		previewText: data.previewText,
		buttonText: t(locale, 'email.body.view_admin_dashboard'),
		footerText: t(locale, 'email.new_customer.footer', { timeZone: data.timeZone })
	};

	let timeline: { html: string; text: string };
	if (journey) {
		const tiles = renderTiles(journey);
		const rail = buildJourneyTimeline(
			journey.steps,
			journey.notes,
			{ locale: lang, timeZone: data.timeZone },
			journey.theme.rail
		);
		timeline = {
			html: `${tiles.html}${rail.html}`,
			text: [tiles.text, rail.text].filter(Boolean).join('\n\n')
		};
	} else {
		const note = t(locale, 'email.new_customer.journey_unavailable');
		timeline = {
			html: `<p class="dark_text-zinc-400" style="margin:0 0 24px;font-size:13px;line-height:20px;color:#71717b">${escapeHtml(note)}</p>`,
			text: note
		};
	}

	const templateData = {
		lang,
		timelineHtml: timeline.html,
		adminDashboardLink: escapeHtml(data.adminDashboardLink),
		baseUrl: escapeHtml(baseUrl),
		...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, escapeHtml(v)]))
	};
	const textData = {
		// The button follows the placeholder on the same line of the text template.
		timelineHtml: `${timeline.text}\n\n`,
		adminDashboardLink: data.adminDashboardLink,
		baseUrl,
		...texts
	};

	return {
		subject: t(locale, 'email.subject.new_customer', { customer, amount }),
		html: renderTemplate(NEWCUSTOMERADMINNOTIFICATION_HTML, templateData),
		text: renderTemplate(NEWCUSTOMERADMINNOTIFICATION_TEXT, textData)
	};
}

// Spelled out rather than composed from the bucket name, so the orphan-key check
// can see that every label is used.
const RATE_LIMIT_ALERT_LIMIT_NAME_KEYS: Record<SupportRateLimitAlertEmailData['bucket'], string> = {
	supportThreadCreateAnon: 'email.rate_limit_alert.limit_thread_create',
	supportFileUploadAnon: 'email.rate_limit_alert.limit_file_upload',
	supportFilePreviewAnon: 'email.rate_limit_alert.limit_file_preview'
};

/** Localized name of a monitored rate limit, shared by the alert body and subject. */
export function getRateLimitAlertLimitName(
	bucket: SupportRateLimitAlertEmailData['bucket'],
	locale: string = DEFAULT_LOCALE
): string {
	return t(locale, RATE_LIMIT_ALERT_LIMIT_NAME_KEYS[bucket]);
}

/**
 * Render support rate limit alert email
 *
 * Sent to admins when a global anonymous support rate limit stays nearly used up.
 *
 * @param data - Bucket, its sampled level and refill rate, and the admin dashboard link
 * @param locale - Locale for translated strings (optional, defaults to DEFAULT_LOCALE)
 * @returns Rendered HTML and plain text email
 */
export function renderSupportRateLimitAlertEmail(
	data: SupportRateLimitAlertEmailData,
	locale: string = DEFAULT_LOCALE
): RenderedEmail {
	const baseUrl = getBaseUrl();
	const limitName = getRateLimitAlertLimitName(data.bucket, locale);
	const usedPercent = Math.round((1 - data.available / data.capacity) * 100);
	const level = { available: data.available, capacity: data.capacity };

	const texts = {
		badgeText: t(locale, 'email.badge.alert'),
		titleText: t(locale, 'email.rate_limit_alert.title'),
		descriptionText: t(locale, 'email.rate_limit_alert.description', {
			limitName,
			usedPercent,
			minutes: data.lowForMinutes
		}),
		previewText: t(locale, 'email.rate_limit_alert.preview', { limitName, ...level }),
		limitLabel: t(locale, 'email.rate_limit_alert.label_limit'),
		limitName,
		remainingLabel: t(locale, 'email.rate_limit_alert.label_remaining'),
		remainingText: t(locale, 'email.rate_limit_alert.remaining', level),
		refillLabel: t(locale, 'email.rate_limit_alert.label_refill'),
		refillText: t(locale, 'email.rate_limit_alert.refill', { ratePerHour: data.ratePerHour }),
		impactText: t(locale, 'email.rate_limit_alert.impact'),
		actionText: t(locale, 'email.rate_limit_alert.action'),
		buttonText: t(locale, 'email.body.view_admin_dashboard'),
		footerText: t(locale, 'email.rate_limit_alert.footer', { hours: data.cooldownHours })
	};

	const templateData = {
		lang: getValidLocale(locale),
		adminDashboardLink: escapeHtml(data.adminDashboardLink),
		baseUrl: escapeHtml(baseUrl),
		...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, escapeHtml(v)]))
	};
	const textData = { adminDashboardLink: data.adminDashboardLink, baseUrl, ...texts };

	return {
		html: renderTemplate(SUPPORTRATELIMITALERT_HTML, templateData),
		text: renderTemplate(SUPPORTRATELIMITALERT_TEXT, textData)
	};
}
