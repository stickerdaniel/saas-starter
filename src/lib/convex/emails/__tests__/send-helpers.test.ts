import { describe, it, expect } from 'vitest';

/**
 * Tests for email send helper functions.
 *
 * Note: We test the helper logic directly since the actual send functions
 * are Convex internal mutations that require the full Convex runtime.
 */

// Test the isTestEmail logic (mirrored from send.ts)
function isTestEmail(email: string): boolean {
	return email.endsWith('@e2e.example.com');
}

describe('isTestEmail', () => {
	it('returns true for e2e test emails', () => {
		expect(isTestEmail('test-user@e2e.example.com')).toBe(true);
		expect(isTestEmail('test-admin-123@e2e.example.com')).toBe(true);
		expect(isTestEmail('any@e2e.example.com')).toBe(true);
	});

	it('returns false for regular emails', () => {
		expect(isTestEmail('user@example.com')).toBe(false);
		expect(isTestEmail('user@gmail.com')).toBe(false);
		expect(isTestEmail('admin@company.io')).toBe(false);
	});

	it('returns false for similar but different domains', () => {
		expect(isTestEmail('user@e2e.example.org')).toBe(false);
		expect(isTestEmail('user@test.example.com')).toBe(false);
		expect(isTestEmail('user@e2eexample.com')).toBe(false);
		expect(isTestEmail('user@fake-e2e.example.com')).toBe(false);
	});

	it('is case sensitive (emails should be lowercase)', () => {
		// Email domains are case-insensitive, but our check is case-sensitive
		// This is acceptable since test emails are always generated lowercase
		expect(isTestEmail('user@E2E.EXAMPLE.COM')).toBe(false);
	});

	it('handles edge cases', () => {
		expect(isTestEmail('')).toBe(false);
		expect(isTestEmail('@e2e.example.com')).toBe(true); // Just the domain
		expect(isTestEmail('e2e.example.com')).toBe(false); // No @
	});
});

// Test the shouldSkipTestEmail logic (mirrored from send.ts)
function shouldSkipTestEmail(action: string, email: string): boolean {
	if (isTestEmail(email)) {
		// In actual code: console.log(`[${action}] Skipping test email: ${email}`);
		return true;
	}
	return false;
}

describe('shouldSkipTestEmail', () => {
	it('returns true and would log for test emails', () => {
		expect(shouldSkipTestEmail('sendVerificationEmail', 'test@e2e.example.com')).toBe(true);
		expect(shouldSkipTestEmail('sendResetPasswordEmail', 'user@e2e.example.com')).toBe(true);
	});

	it('returns false for regular emails', () => {
		expect(shouldSkipTestEmail('sendVerificationEmail', 'user@example.com')).toBe(false);
		expect(shouldSkipTestEmail('sendResetPasswordEmail', 'admin@company.com')).toBe(false);
	});
});
