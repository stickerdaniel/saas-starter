import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from '../url';

describe('safeRedirectPath', () => {
	const fallback = '/fallback';

	it('allows valid relative paths', () => {
		expect(safeRedirectPath('/app', fallback)).toBe('/app');
		expect(safeRedirectPath('/app/dashboard', fallback)).toBe('/app/dashboard');
		expect(safeRedirectPath('/settings/profile', fallback)).toBe('/settings/profile');
		expect(safeRedirectPath('/app?foo=bar', fallback)).toBe('/app?foo=bar');
		expect(safeRedirectPath('/app#section', fallback)).toBe('/app#section');
	});

	it('blocks absolute URLs', () => {
		expect(safeRedirectPath('http://evil.com', fallback)).toBe(fallback);
		expect(safeRedirectPath('https://evil.com', fallback)).toBe(fallback);
		expect(safeRedirectPath('http://evil.com/path', fallback)).toBe(fallback);
		expect(safeRedirectPath('https://example.com/login', fallback)).toBe(fallback);
	});

	it('blocks protocol-relative URLs', () => {
		expect(safeRedirectPath('//evil.com', fallback)).toBe(fallback);
		expect(safeRedirectPath('//evil.com/path', fallback)).toBe(fallback);
		expect(safeRedirectPath('//example.com', fallback)).toBe(fallback);
	});

	it('blocks javascript: URIs', () => {
		expect(safeRedirectPath('javascript:alert(1)', fallback)).toBe(fallback);
		expect(safeRedirectPath('javascript:void(0)', fallback)).toBe(fallback);
	});

	it('blocks data: URIs', () => {
		expect(safeRedirectPath('data:text/html,<script>alert(1)</script>', fallback)).toBe(fallback);
	});

	it('blocks file: URIs', () => {
		expect(safeRedirectPath('file:///etc/passwd', fallback)).toBe(fallback);
	});

	it('blocks other protocols', () => {
		expect(safeRedirectPath('ftp://example.com', fallback)).toBe(fallback);
		expect(safeRedirectPath('tel:+1234567890', fallback)).toBe(fallback);
		expect(safeRedirectPath('mailto:test@example.com', fallback)).toBe(fallback);
	});

	it('returns fallback for empty string', () => {
		expect(safeRedirectPath('', fallback)).toBe(fallback);
	});

	it('returns fallback for null/undefined-like values', () => {
		// TypeScript won't allow these, but test runtime behavior
		expect(safeRedirectPath(null as any, fallback)).toBe(fallback);
		expect(safeRedirectPath(undefined as any, fallback)).toBe(fallback);
	});

	it('blocks paths that do not start with /', () => {
		expect(safeRedirectPath('app', fallback)).toBe(fallback);
		expect(safeRedirectPath('app/dashboard', fallback)).toBe(fallback);
		expect(safeRedirectPath('relative/path', fallback)).toBe(fallback);
	});

	it('handles edge cases with special characters', () => {
		// Valid paths with encoded characters
		expect(safeRedirectPath('/path%20with%20spaces', fallback)).toBe('/path%20with%20spaces');
		expect(safeRedirectPath('/path?query=value%26more', fallback)).toBe(
			'/path?query=value%26more'
		);

		// Suspicious patterns should still be blocked if they don't start with /
		expect(safeRedirectPath('%2F%2Fevil.com', fallback)).toBe(fallback);
	});

	it('preserves query parameters and fragments in valid paths', () => {
		expect(safeRedirectPath('/app?redirect=/settings', fallback)).toBe('/app?redirect=/settings');
		expect(safeRedirectPath('/app#section', fallback)).toBe('/app#section');
		expect(safeRedirectPath('/app?foo=bar&baz=qux#top', fallback)).toBe('/app?foo=bar&baz=qux#top');
	});
});
