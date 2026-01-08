import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	renderVerificationEmail,
	renderVerificationCodeEmail,
	renderPasswordResetEmail,
	renderAdminReplyNotificationEmail
} from '$lib/convex/emails/templates';

describe('Email Template Rendering', () => {
	const originalEnv = process.env.APP_URL;

	beforeEach(() => {
		process.env.APP_URL = 'https://test.example.com';
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.APP_URL = originalEnv;
		} else {
			delete process.env.APP_URL;
		}
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
