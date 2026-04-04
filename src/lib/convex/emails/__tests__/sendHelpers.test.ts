import { describe, it, expect } from 'vitest';
import { isTestEmail, shouldSkipTestEmail, getFounderWelcomeDelay } from '../helpers';

/**
 * Tests for email send helper functions.
 *
 * Note: We test the helper logic directly since the actual send functions
 * are Convex internal mutations that require the full Convex runtime.
 */

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

describe('getFounderWelcomeDelay', () => {
	it('returns value between 16 and 19 minutes (sampled 100x)', () => {
		const MIN = 16 * 60 * 1000;
		const MAX = 19 * 60 * 1000;

		for (let i = 0; i < 100; i++) {
			const delay = getFounderWelcomeDelay();
			expect(delay).toBeGreaterThanOrEqual(MIN);
			expect(delay).toBeLessThan(MAX);
		}
	});
});
