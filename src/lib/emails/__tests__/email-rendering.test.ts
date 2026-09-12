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
import {
	renderVerificationEmail,
	renderVerificationCodeEmail,
	renderPasswordResetEmail,
	renderAdminReplyNotificationEmail,
	renderNewTicketAdminNotificationEmail,
	renderNewUserSignupNotificationEmail
} from '$lib/convex/emails/templates';

describe('Email Template Rendering', () => {
	describe('Email CSS', () => {
		it('removes custom cursor image declarations', () => {
			expect(
				sanitizeEmailCss("body { color: black; cursor: url('/cursor.svg') 4 2, default; }")
			).toBe('body { color: black;  }');
		});

		it('retains ordinary cursor declarations', () => {
			expect(sanitizeEmailCss('a { cursor: pointer; }')).toBe('a { cursor: pointer; }');
		});

		// The app's `dark` variant resolves to a `.dark` ancestor that no email
		// client renders, so it has to go for darkMode: 'media' to take effect. The
		// other custom variants are still needed to resolve their own utilities.
		it('removes the dark custom variant and keeps the data-* ones', () => {
			const css = [
				'@custom-variant dark (&:is(.dark *));',
				'@custom-variant data-open {',
				"\t&[data-state='open'] {",
				'\t\t@slot;',
				'\t}',
				'}',
				'@custom-variant data-closed (&[data-state="closed"]);',
				'@custom-variant data-checked (&[data-state="checked"]);'
			].join('\n');

			const sanitized = sanitizeEmailCss(css);

			expect(sanitized).not.toContain('@custom-variant dark');
			expect(sanitized).toContain('@custom-variant data-open');
			expect(sanitized).toContain("&[data-state='open']");
			expect(sanitized).toContain('@custom-variant data-closed');
			expect(sanitized).toContain('@custom-variant data-checked');
		});

		it('retains dark custom variant text inside comments', () => {
			const css = ['/* @custom-variant dark (&:is(.dark *)); */', '.card { color: black; }'].join(
				'\n'
			);

			expect(sanitizeEmailCss(css)).toBe(css);
		});

		it('retains dark custom variant text inside strings', () => {
			const css = [
				`.single::before { content: '@custom-variant dark { ; }'; }`,
				`.double::before { content: "escaped \\" @custom-variant dark (&:is(.dark *));"; }`
			].join('\n');

			expect(sanitizeEmailCss(css)).toBe(css);
		});

		it('retains an at-keyword inside a custom property value', () => {
			const css = '.x { --documentation: @custom-variant dark; color: red; }';

			expect(sanitizeEmailCss(css)).toBe(css);
		});

		it('removes a dark custom variant nested at a statement boundary', () => {
			const css = [
				'@media screen {',
				'\t@custom-variant dark (&:is(.dark *));',
				'\t.card { color: black; }',
				'}'
			].join('\n');

			expect(sanitizeEmailCss(css)).toBe(
				['@media screen {', '\t', '\t.card { color: black; }', '}'].join('\n')
			);
		});

		it('skips protected punctuation while finding the at-rule end', () => {
			const css = [
				'.before { color: black; }',
				'@custom-variant dark {',
				'\t/* } ; */',
				'\t.example::before { content: "} ; \\" still string"; }',
				'\t.escaped { --value: \\}; }',
				'}',
				'@custom-variant dark (&:is([data-label=");"] *));',
				'.after { color: white; }'
			].join('\n');

			expect(sanitizeEmailCss(css)).toBe(
				['.before { color: black; }', '', '', '.after { color: white; }'].join('\n')
			);
		});

		it('retains similarly named and incomplete custom variants', () => {
			const css = [
				'@custom-variant dark-mode (&:is(.dark-mode *));',
				'@custom-variant dark { .card { color: black; }'
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

	describe('Placeholder replacement', () => {
		it('replaces verificationUrl placeholder', () => {
			const result = renderVerificationEmail('https://test.com/verify/abc123', 30);
			expect(result.html).toContain('https://test.com/verify/abc123');
			expect(result.html).not.toContain('{{verificationUrl}}');
			expect(result.text).toContain('https://test.com/verify/abc123');
			expect(result.text).not.toContain('{{verificationUrl}}');
		});

		it('replaces expiryMinutes as number', () => {
			const result = renderVerificationEmail('https://test.com', 45);
			expect(result.html).toContain('45');
			expect(result.text).toContain('45');
			expect(result.html).not.toContain('{{expiryMinutes}}');
		});

		it('replaces verification code placeholder', () => {
			const result = renderVerificationCodeEmail('12345678', 30);
			expect(result.html).toContain('12345678');
			expect(result.text).toContain('12345678');
			expect(result.html).not.toContain('{{code}}');
		});

		it('replaces resetUrl placeholder', () => {
			const result = renderPasswordResetEmail('https://test.com/reset/token123', 'User');
			expect(result.html).toContain('https://test.com/reset/token123');
			expect(result.text).toContain('https://test.com/reset/token123');
			expect(result.html).not.toContain('{{resetUrl}}');
		});

		it('replaces multiple placeholders in admin notification', () => {
			const result = renderAdminReplyNotificationEmail(
				'John Admin',
				'This is a preview of the message',
				'https://example.com/view/123'
			);
			expect(result.html).toContain('John Admin');
			expect(result.html).toContain('This is a preview of the message');
			expect(result.html).toContain('https://example.com/view/123');
			expect(result.html).not.toContain('{{adminName}}');
			expect(result.html).not.toContain('{{messagePreview}}');
			expect(result.html).not.toContain('{{deepLink}}');
		});

		it('replaces baseUrl from environment', () => {
			const result = renderVerificationEmail('https://test.com', 30);
			expect(result.html).toContain('https://test.example.com');
			expect(result.html).not.toContain('{{baseUrl}}');
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

		it('sets the html lang attribute from the locale', () => {
			expect(renderVerificationEmail('https://example.com', 30, 'de').html).toContain('lang="de"');
			expect(renderVerificationCodeEmail('12345678', 30, 'es').html).toContain('lang="es"');
			expect(renderPasswordResetEmail('https://example.com', 'Max', 'fr').html).toContain(
				'lang="fr"'
			);
			expect(
				renderAdminReplyNotificationEmail('Admin', 'Hi', 'https://example.com', 'de').html
			).toContain('lang="de"');
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
			expect(result.html).toContain('0');
			expect(result.text).toContain('0');
		});
	});

	describe('Render function output structure', () => {
		it.each([
			['renderVerificationEmail', () => renderVerificationEmail('https://example.com', 30)],
			['renderVerificationCodeEmail', () => renderVerificationCodeEmail('12345678', 30)],
			['renderPasswordResetEmail', () => renderPasswordResetEmail('https://example.com', 'User')],
			[
				'renderAdminReplyNotificationEmail',
				() => renderAdminReplyNotificationEmail('Admin', 'Preview', 'https://example.com')
			]
		])('%s returns html and text properties', (name, fn) => {
			const result = fn();
			expect(result).toHaveProperty('html');
			expect(result).toHaveProperty('text');
			expect(typeof result.html).toBe('string');
			expect(typeof result.text).toBe('string');
			expect(result.html.length).toBeGreaterThan(0);
			expect(result.text.length).toBeGreaterThan(0);
		});

		it.each([
			['renderVerificationEmail', () => renderVerificationEmail('https://example.com', 30)],
			['renderVerificationCodeEmail', () => renderVerificationCodeEmail('12345678', 30)],
			['renderPasswordResetEmail', () => renderPasswordResetEmail('https://example.com', 'User')],
			[
				'renderAdminReplyNotificationEmail',
				() => renderAdminReplyNotificationEmail('Admin', 'Preview', 'https://example.com')
			]
		])('%s HTML output contains valid structure', (name, fn) => {
			const result = fn();
			expect(result.html).toContain('<!DOCTYPE');
			expect(result.html).toContain('<html');
			expect(result.html).toContain('</html>');
		});
	});
});
