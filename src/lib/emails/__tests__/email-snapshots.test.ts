import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('Generated Email Templates', () => {
	const generatedDir = join(process.cwd(), 'src/lib/convex/emails/generated');

	describe('VerificationEmail', () => {
		it('generates verification template files', () => {
			const filePath = join(generatedDir, 'verification.ts');
			expect(existsSync(filePath)).toBe(true);
		});

		it('contains required HTML export', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('export const VERIFICATION_HTML');
		});

		it('contains required TEXT export', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('export const VERIFICATION_TEXT');
		});

		it('includes placeholders for code', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('{{code}}');
		});

		it('includes placeholders for expiryMinutes', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('{{expiryMinutes}}');
		});

		it('includes placeholders for baseUrl', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('{{baseUrl}}');
		});

		it('matches snapshot structure', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toMatchSnapshot();
		});
	});

	describe('PasswordResetEmail', () => {
		it('generates password reset template files', () => {
			const filePath = join(generatedDir, 'passwordReset.ts');
			expect(existsSync(filePath)).toBe(true);
		});

		it('contains required HTML export', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('export const PASSWORDRESET_HTML');
		});

		it('contains required TEXT export', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('export const PASSWORDRESET_TEXT');
		});

		it('includes placeholders for resetUrl', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('{{resetUrl}}');
		});

		it('includes placeholders for userName', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('{{userName}}');
		});

		it('includes placeholders for baseUrl', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('{{baseUrl}}');
		});

		it('matches snapshot structure', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toMatchSnapshot();
		});
	});

	describe('AdminReplyNotificationEmail', () => {
		it('generates admin reply template files', () => {
			const filePath = join(generatedDir, 'adminReplyNotification.ts');
			expect(existsSync(filePath)).toBe(true);
		});

		it('contains required HTML export', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('export const ADMINREPLYNOTIFICATION_HTML');
		});

		it('contains required TEXT export', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('export const ADMINREPLYNOTIFICATION_TEXT');
		});

		it('includes placeholders for adminName', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('{{adminName}}');
		});

		it('includes placeholders for messagePreview', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('{{messagePreview}}');
		});

		it('includes placeholders for deepLink', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('{{deepLink}}');
		});

		it('includes placeholders for baseUrl', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('{{baseUrl}}');
		});

		it('matches snapshot structure', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toMatchSnapshot();
		});
	});

	describe('Index Export', () => {
		it('generates index file', () => {
			const filePath = join(generatedDir, 'index.ts');
			expect(existsSync(filePath)).toBe(true);
		});

		it('exports all template modules', () => {
			const content = readFileSync(join(generatedDir, 'index.ts'), 'utf-8');

			// Check for module exports
			expect(content).toContain("export * from './verification.js'");
			expect(content).toContain("export * from './passwordReset.js'");
			expect(content).toContain("export * from './adminReplyNotification.js'");
		});
	});

	describe('Template Quality', () => {
		it('verification HTML template is not empty', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			const htmlMatch = content.match(/export const VERIFICATION_HTML = `([^`]+)`/s);
			expect(htmlMatch).toBeTruthy();
			expect(htmlMatch![1].length).toBeGreaterThan(100);
		});

		it('verification TEXT template is not empty', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			const textMatch = content.match(/export const VERIFICATION_TEXT = `([^`]+)`/s);
			expect(textMatch).toBeTruthy();
			expect(textMatch![1].length).toBeGreaterThan(50);
		});

		it('templates do not contain raw Svelte syntax', () => {
			const files = ['verification.ts', 'passwordReset.ts', 'adminReplyNotification.ts'];

			files.forEach((file) => {
				const content = readFileSync(join(generatedDir, file), 'utf-8');

				// Should not have Svelte script tags
				expect(content).not.toContain('<script');

				// Should not have Svelte let bindings
				expect(content).not.toContain('let {');
				expect(content).not.toContain('$props()');
			});
		});

		it('templates contain valid HTML structure', () => {
			const files = ['verification.ts', 'passwordReset.ts', 'adminReplyNotification.ts'];

			files.forEach((file) => {
				const content = readFileSync(join(generatedDir, file), 'utf-8');

				// Should have HTML doctype
				expect(content).toContain('<!DOCTYPE');

				// Should have closing html tag
				expect(content).toContain('</html>');

				// Should have head and body
				expect(content).toContain('<head');
				expect(content).toContain('<body');
			});
		});
	});
});
