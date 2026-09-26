import { describe, it, expect, vi } from 'vitest';

// Mock the validated email capability before importing templates.
vi.mock('$lib/convex/env', () => ({
	requireEmailConfiguration: () => ({
		apiKey: 'configured',
		sender: 'test@example.com',
		assetUrl: 'https://test.example.com'
	})
}));

import { sanitizeEmailCss } from '../email-css';
import { STATIC_TRANSLATIONS, SUPPORTED_LOCALES } from '$lib/i18n/static-translations.generated';
import type { NewUserSignupNotificationEmailData, RenderedEmail } from '../templates/types';
import { LEGAL_CONFIG } from '$lib/config/legal';
import {
	renderVerificationEmail,
	renderVerificationCodeEmail,
	renderPasswordResetEmail,
	renderAdminReplyNotificationEmail,
	renderNewTicketAdminNotificationEmail,
	renderNewUserSignupNotificationEmail
} from '$lib/convex/emails/templates';

const ASSET_URL = 'https://test.example.com';

type EmailStrings = (typeof STATIC_TRANSLATIONS)[(typeof SUPPORTED_LOCALES)[number]]['email'];

interface RendererCase {
	name: string;
	render: (locale: string) => RenderedEmail;
	/** The link the reader is asked to follow, with the localized text it must carry. */
	action?: { href: string; text: (strings: EmailStrings) => string };
	/** Localized copy the reader must see in the HTML body and in the plain text. */
	copy: (strings: EmailStrings) => string[];
	/** Caller values that must reach both outputs unchanged. */
	values: string[];
}

/** Interpolates `{name}` parameters the way the translation files write them. */
function fill(message: string, params: Record<string, string | number>): string {
	return message.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key]));
}

function collapse(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** Text a reader sees, leaving out the hidden inbox preview line. */
function visibleText(body: HTMLElement): string {
	const copy = body.cloneNode(true) as HTMLElement;
	for (const element of copy.querySelectorAll<HTMLElement>('*')) {
		if (element.style.display === 'none') element.remove();
	}
	return collapse(copy.textContent ?? '');
}

// Caller values carry markup characters so that escaping failures change what a reader sees.
const markupName = `O'Brien <Ops> & "Co"`;
const verificationUrl = 'https://app.example.com/verify?token=a1&next=/app';
const resetUrl = 'https://app.example.com/reset?token=a1&next=/app';
// Differs from every expiry the other cases pass, so a renderer ignoring the caller's value fails.
const expiryMinutes = 45;
const deepLink = 'https://app.example.com/support?thread=7&view=full';
const adminDashboardLink = 'https://app.example.com/admin/support?ticket=7&tab=open';
const messagePreview = `It's <b>fixed</b> & "done"`;
const ticketMessage = { text: `<b>Help</b> & 'thanks'`, timestamp: 'Jan 15, 10:30 AM' };
const signup: NewUserSignupNotificationEmailData = {
	userName: markupName,
	userEmail: 'max+ops@example.com',
	signupMethod: 'Email',
	signupTime: 'Jan 15, 2026 at 3:45 PM',
	adminDashboardLink
};

// Every public renderer reads one generated module through the generated index, so a
// template missing from that index cannot render here.
const RENDERERS: RendererCase[] = [
	{
		name: 'renderVerificationEmail',
		render: (locale) => renderVerificationEmail(verificationUrl, expiryMinutes, locale),
		action: { href: verificationUrl, text: (s) => s.verification.button },
		copy: (s) => [
			s.badge.auth,
			s.verification.title,
			s.verification.description,
			s.verification.intro,
			fill(s.verification.expiry, { expiryMinutes }),
			s.verification.disclaimer
		],
		values: []
	},
	{
		name: 'renderVerificationCodeEmail',
		render: (locale) => renderVerificationCodeEmail('48151623', expiryMinutes, locale),
		copy: (s) => [
			s.badge.auth,
			s.verification_code.title,
			s.verification_code.description,
			fill(s.verification_code.expiry, { expiryMinutes }),
			s.verification_code.disclaimer
		],
		values: ['48151623']
	},
	{
		name: 'renderPasswordResetEmail',
		render: (locale) => renderPasswordResetEmail(resetUrl, markupName, locale),
		action: { href: resetUrl, text: (s) => s.reset_password.button },
		copy: (s) => [
			s.badge.auth,
			s.reset_password.title,
			fill(s.reset_password.greeting, { userName: markupName }),
			s.reset_password.body,
			s.reset_password.expiry,
			s.reset_password.disclaimer
		],
		values: []
	},
	{
		name: 'renderAdminReplyNotificationEmail',
		render: (locale) =>
			renderAdminReplyNotificationEmail(markupName, messagePreview, deepLink, locale),
		action: { href: deepLink, text: (s) => s.admin_reply.button },
		// Replies go out from AUTH_EMAIL with no replyTo or inbound path, so the
		// email itself must say that answering it does not reach the thread.
		copy: (s) => [
			s.badge.support,
			s.admin_reply.title,
			fill(s.admin_reply.description, { adminName: markupName }),
			s.admin_reply.reply_hint,
			s.admin_reply.footer
		],
		values: [messagePreview]
	},
	{
		name: 'renderNewTicketAdminNotificationEmail',
		render: (locale) =>
			renderNewTicketAdminNotificationEmail(
				{
					isReopen: false,
					isBareHandoff: false,
					userName: markupName,
					messages: [ticketMessage],
					adminDashboardLink
				},
				locale
			),
		action: { href: adminDashboardLink, text: (s) => s.body.view_admin_dashboard },
		copy: (s) => [
			s.badge.support,
			s.body.ticket_new,
			fill(s.body.ticket_started, { userName: markupName }),
			s.body.ticket_footer
		],
		values: [ticketMessage.timestamp, ticketMessage.text]
	},
	{
		name: 'renderNewUserSignupNotificationEmail',
		render: (locale) => renderNewUserSignupNotificationEmail(signup, locale),
		action: { href: adminDashboardLink, text: (s) => s.body.view_admin_dashboard },
		copy: (s) => [
			s.badge.stats,
			s.new_signup.title,
			s.new_signup.description,
			s.new_signup.label_name,
			s.new_signup.label_email,
			s.new_signup.label_method,
			s.new_signup.label_time,
			s.new_signup.footer
		],
		values: [signup.userName, signup.userEmail, signup.signupMethod, signup.signupTime]
	}
];

describe('Email Template Rendering', () => {
	describe.each(RENDERERS)('$name', ({ render, action, copy, values }) => {
		it.each(SUPPORTED_LOCALES)('delivers the complete %s email', (locale) => {
			const strings = STATIC_TRANSLATIONS[locale].email;
			const { html, text } = render(locale);
			const document = new DOMParser().parseFromString(html, 'text/html');
			const visible = visibleText(document.body);
			const plain = collapse(text);

			expect(document.documentElement.lang).toBe(locale);
			expect(html, 'HTML keeps an unresolved placeholder').not.toMatch(/\{\{\w+\}\}/);
			expect(text, 'Plain text keeps an unresolved placeholder').not.toMatch(/\{\{\w+\}\}/);

			const expected = [...copy(strings), ...values];
			if (action) expected.push(action.text(strings));
			for (const value of expected) {
				expect(value, 'Every locale needs this email copy').toBeTruthy();
				expect(visible, 'HTML body').toContain(collapse(value));
				expect(plain, 'Plain text').toContain(collapse(value));
			}

			if (action) {
				const links = [...document.querySelectorAll('a')].filter(
					(link) => link.getAttribute('href') === action.href
				);
				expect(links.map((link) => collapse(link.textContent ?? ''))).toEqual([
					collapse(action.text(strings))
				]);
				expect(plain).toContain(action.href);
			}

			// The footer's company name links to the product's own origin.
			const companyLinks = [...document.querySelectorAll('p')]
				.filter((paragraph) => collapse(paragraph.textContent ?? '').startsWith('Copyright ©'))
				.flatMap((paragraph) => [...paragraph.querySelectorAll('a')])
				.filter((link) => collapse(link.textContent ?? '') === collapse(LEGAL_CONFIG.companyName));
			expect(
				companyLinks.map((link) => link.getAttribute('href')),
				'Footer company link'
			).toEqual([`${ASSET_URL}/`]);
			expect(
				text
					.split(/\n\s*\n/)
					.map(collapse)
					.find((block) => block.startsWith('Copyright ©')),
				'Plain-text footer company link'
			).toContain(`[${ASSET_URL}/]`);

			const images = [...document.querySelectorAll('img')].map((image) =>
				image.getAttribute('src')
			);
			expect(images.length).toBeGreaterThan(0);
			for (const src of images) {
				expect(src?.startsWith(`${ASSET_URL}/`), `${src} is not served from the asset origin`).toBe(
					true
				);
			}
		});
	});

	it('never leaks the web-only Fontaine fallback family into delivered emails', () => {
		// Fontaine appends an "Outfit fallback" family to the web app's font
		// usages for CLS. Emails build from the same shared font tokens, so a
		// regression that wires that fallback into the --font-* tokens would leak
		// a font family no email client can resolve. Guard the boundary.
		for (const { name, render } of RENDERERS) {
			expect(render('en').html, `${name} leaked the web-only fallback family`).not.toMatch(
				/Outfit fallback/
			);
		}
	});

	describe('Email CSS', () => {
		it('removes custom cursor image declarations', () => {
			expect(
				sanitizeEmailCss("body { color: black; cursor: url('/cursor.svg') 4 2, default; }")
			).toBe('body { color: black;  }');
		});

		it('retains ordinary cursor declarations', () => {
			expect(sanitizeEmailCss('a { cursor: pointer; }')).toBe('a { cursor: pointer; }');
		});

		it('retains all custom variant declarations verbatim', () => {
			const css = [
				'@custom-variant dark (&:is(.dark *));',
				'@custom-variant /* explanation */ dark (&:is(.dark *));',
				'@custom-variant data-open {',
				"\t&[data-state='open'] {",
				'\t\t@slot;',
				'\t}',
				'}',
				'@custom-variant dark { .card { color: black; }'
			].join('\n');

			expect(sanitizeEmailCss(css)).toBe(css);
		});

		it('retains custom variant text in arbitrary CSS values', () => {
			const css = [
				'.plain { --documentation: @custom-variant dark; color: red; }',
				'.structured { --documentation: fn(a; @custom-variant dark; b); }',
				`.single::before { content: '@custom-variant dark { ; }'; }`,
				`.double::before { content: "escaped \\" @custom-variant dark (&:is(.dark *));"; }`,
				'/* @custom-variant dark (&:is(.dark *)); */'
			].join('\n');

			expect(sanitizeEmailCss(css)).toBe(css);
		});
	});

	describe('HTML escaping', () => {
		it('escapes < and > in userName', () => {
			const result = renderPasswordResetEmail(
				'https://example.com/reset',
				'<script>alert(1)</script>'
			);
			expect(result.html).toContain('&lt;script&gt;');
			expect(result.html).not.toContain('<script>alert(1)</script>');
		});

		it('escapes & in URLs', () => {
			const result = renderVerificationEmail('https://example.com?a=1&b=2', 30);
			expect(result.html).toContain('a=1&amp;b=2');
		});

		it('escapes quotes in messagePreview', () => {
			const result = renderAdminReplyNotificationEmail(
				'Admin',
				'He said "hello"',
				'https://example.com'
			);
			expect(result.html).toContain('&quot;hello&quot;');
		});

		it('escapes apostrophes', () => {
			const result = renderPasswordResetEmail('https://example.com', "O'Brien");
			expect(result.html).toContain('O&#39;Brien');
		});

		it('escapes all special characters together', () => {
			const result = renderAdminReplyNotificationEmail(
				'<Admin>',
				'Test & \'quotes\' "double"',
				'https://example.com?x=1&y=2'
			);
			expect(result.html).toContain('&lt;Admin&gt;');
			expect(result.html).toContain('&amp;');
			expect(result.html).toContain('&#39;quotes&#39;');
			expect(result.html).toContain('&quot;double&quot;');
		});
	});

	describe('Text versions (no escaping)', () => {
		it('preserves < and > in text output', () => {
			const result = renderPasswordResetEmail('https://example.com', '<User>');
			expect(result.text).toContain('<User>');
		});

		it('preserves & in text URLs', () => {
			const result = renderVerificationEmail('https://example.com?a=1&b=2', 30);
			expect(result.text).toContain('a=1&b=2');
			expect(result.text).not.toContain('&amp;');
		});

		it('preserves quotes in text output', () => {
			const result = renderAdminReplyNotificationEmail(
				'Admin',
				'He said "hello"',
				'https://example.com'
			);
			expect(result.text).toContain('"hello"');
			expect(result.text).not.toContain('&quot;');
		});

		it('preserves apostrophes in text output', () => {
			const result = renderPasswordResetEmail('https://example.com', "O'Brien");
			expect(result.text).toContain("O'Brien");
			expect(result.text).not.toContain('&#39;');
		});
	});

	describe('Default values', () => {
		it('uses "there" when userName is undefined', () => {
			const result = renderPasswordResetEmail('https://example.com');
			expect(result.html).toContain('there');
			expect(result.text).toContain('there');
		});

		it('uses "there" when userName is empty string', () => {
			const result = renderPasswordResetEmail('https://example.com', '');
			expect(result.html).toContain('there');
			expect(result.text).toContain('there');
		});
	});

	describe('Localization', () => {
		it('renders English strings by default', () => {
			const result = renderVerificationEmail('https://example.com', 30);
			expect(result.html).toContain('Verify your email');
			expect(result.text).toContain('This link will expire in 30 minutes.');
		});

		it('renders German verification email', () => {
			const result = renderVerificationEmail('https://example.com', 30, 'de');
			expect(result.html).toContain('E-Mail-Adresse bestätigen');
			expect(result.text).toContain('Dieser Link läuft in 30 Minuten ab.');
		});

		it('renders Spanish verification code email with interpolated code', () => {
			const result = renderVerificationCodeEmail('12345678', 30, 'es');
			expect(result.html).toContain('Tu código de verificación es 12345678');
			expect(result.text).toContain('Este código caducará en 30 minutos.');
		});

		it('renders German password reset greeting with userName', () => {
			const result = renderPasswordResetEmail('https://example.com', 'Max', 'de');
			expect(result.html).toContain('Hallo Max,');
			expect(result.text).toContain('Passwort zurücksetzen');
		});

		it('renders German password reset fallback greeting without userName', () => {
			const result = renderPasswordResetEmail('https://example.com', undefined, 'de');
			expect(result.html).toContain('Hallo,');
		});

		it('renders French admin reply notification with interpolated adminName', () => {
			const result = renderAdminReplyNotificationEmail(
				'Alice',
				'Bonjour',
				'https://example.com',
				'fr'
			);
			expect(result.html).toContain('Alice a répondu à votre conversation de support');
			expect(result.text).toContain('Voir la conversation');
		});

		it('renders German new ticket notification button and footer', () => {
			const result = renderNewTicketAdminNotificationEmail(
				{
					isReopen: false,
					isBareHandoff: false,
					userName: 'Max',
					messages: [{ text: 'Hi', timestamp: 'Jan 15, 10:30 AM' }],
					adminDashboardLink: 'https://example.com/admin/support'
				},
				'de'
			);
			expect(result.html).toContain('Im Admin-Dashboard ansehen');
			expect(result.text).toContain('Sie erhalten diese E-Mail');
		});

		it('uses the handoff empty-state line for a bare handoff with no messages', () => {
			const result = renderNewTicketAdminNotificationEmail(
				{
					isReopen: false,
					isBareHandoff: true,
					userName: 'Max',
					messages: [],
					adminDashboardLink: 'https://example.com/admin/support'
				},
				'en'
			);
			expect(result.html).toContain('The user asked to talk to a human.');
			expect(result.text).toContain('The user asked to talk to a human.');
		});

		it('uses the neutral empty-state line when a non-handoff notification has no messages', () => {
			const result = renderNewTicketAdminNotificationEmail(
				{
					isReopen: true,
					isBareHandoff: false,
					userName: 'Max',
					messages: [],
					adminDashboardLink: 'https://example.com/admin/support'
				},
				'en'
			);
			expect(result.html).toContain('No messages');
			expect(result.html).not.toContain('The user asked to talk to a human.');
		});

		it('renders Spanish new user signup notification', () => {
			const result = renderNewUserSignupNotificationEmail(
				{
					userName: 'Max',
					userEmail: 'max@example.com',
					signupMethod: 'Email',
					signupTime: 'Jan 15, 2026 at 3:45 PM',
					adminDashboardLink: 'https://example.com/admin/users'
				},
				'es'
			);
			expect(result.html).toContain('Nuevo usuario registrado');
			expect(result.html).toContain('Método:');
			expect(result.text).toContain('Ver en el panel de administración');
		});

		it('falls back to English for unsupported locales', () => {
			const result = renderVerificationEmail('https://example.com', 30, 'xx');
			expect(result.html).toContain('Verify your email');
		});

		it('defaults the html lang attribute to en', () => {
			expect(renderVerificationEmail('https://example.com', 30).html).toContain('lang="en"');
		});

		it('falls back to lang="en" for unsupported locales', () => {
			expect(renderVerificationEmail('https://example.com', 30, 'xx').html).toContain('lang="en"');
		});
	});

	describe('Edge cases', () => {
		it('handles empty verification code', () => {
			const result = renderVerificationCodeEmail('', 30);
			expect(result.html).toBeDefined();
			expect(result.text).toBeDefined();
			expect(result.html.length).toBeGreaterThan(0);
		});

		it('handles very long URLs', () => {
			const longUrl = 'https://example.com/' + 'a'.repeat(500);
			const result = renderVerificationEmail(longUrl, 30);
			expect(result.html).toContain('https://example.com/');
			expect(result.html).toContain('a'.repeat(100));
		});

		it('handles unicode characters in userName', () => {
			const result = renderPasswordResetEmail('https://example.com', '日本語ユーザー');
			expect(result.html).toContain('日本語ユーザー');
			expect(result.text).toContain('日本語ユーザー');
		});

		it('handles emoji in admin name', () => {
			const result = renderAdminReplyNotificationEmail('Admin 👋', 'Hello!', 'https://example.com');
			expect(result.html).toContain('Admin 👋');
			expect(result.text).toContain('Admin 👋');
		});

		it('handles newlines in messagePreview', () => {
			const result = renderAdminReplyNotificationEmail(
				'Admin',
				'Line 1\nLine 2',
				'https://example.com'
			);
			expect(result.html).toBeDefined();
			expect(result.text).toContain('Line 1');
		});

		it('handles zero expiryMinutes', () => {
			const result = renderVerificationEmail('https://example.com', 0);
			expect(result.html).toContain('This link will expire in 0 minutes.');
			expect(result.text).toContain('This link will expire in 0 minutes.');
		});
	});
});
