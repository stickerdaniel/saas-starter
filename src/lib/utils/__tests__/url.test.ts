import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from '../url';

describe('safeRedirectPath', () => {
	it('returns a valid relative path unchanged', () => {
		expect(safeRedirectPath('/dashboard', '/')).toBe('/dashboard');
	});

	it('returns a valid nested path unchanged', () => {
		expect(safeRedirectPath('/app/settings', '/')).toBe('/app/settings');
	});

	it('returns a path with query params unchanged', () => {
		expect(safeRedirectPath('/app?foo=bar', '/')).toBe('/app?foo=bar');
	});

	it('rejects a protocol-relative URL', () => {
		expect(safeRedirectPath('//evil.com', '/')).toBe('/');
	});

	it('rejects an absolute http URL', () => {
		expect(safeRedirectPath('http://evil.com', '/')).toBe('/');
	});

	it('rejects a javascript: URI', () => {
		expect(safeRedirectPath('javascript:alert(1)', '/')).toBe('/');
	});

	it('rejects an empty string', () => {
		expect(safeRedirectPath('', '/')).toBe('/');
	});

	it('returns / as the fallback when passed as the fallback argument', () => {
		expect(safeRedirectPath('//evil.com', '/')).toBe('/');
	});

	it('returns a custom fallback when the path is invalid', () => {
		expect(safeRedirectPath('http://evil.com', '/home')).toBe('/home');
	});
});
