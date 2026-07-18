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

	it('preserves a same-origin query and hash', () => {
		expect(safeRedirectPath('/de/app?tab=one#profile', '/')).toBe('/de/app?tab=one#profile');
	});

	it('rejects a protocol-relative URL', () => {
		expect(safeRedirectPath('//evil.com', '/')).toBe('/');
	});

	it('rejects an absolute http URL', () => {
		expect(safeRedirectPath('http://evil.com', '/')).toBe('/');
	});

	it('rejects backslash and encoded network-path variants', () => {
		expect(safeRedirectPath('/\\evil.com', '/')).toBe('/');
		expect(safeRedirectPath('/%2f%2fevil.com', '/')).toBe('/');
		expect(safeRedirectPath('/%5c%5cevil.com', '/')).toBe('/');
	});

	it('rejects control characters and malformed escapes', () => {
		expect(safeRedirectPath('/de/app\nLocation: https://evil.test', '/')).toBe('/');
		expect(safeRedirectPath('/de/%zz', '/')).toBe('/');
	});

	it('rejects percent-encoded control characters', () => {
		expect(safeRedirectPath('/de/app%0d%0aLocation:%20https://evil.test', '/')).toBe('/');
		expect(safeRedirectPath('/app%09/next', '/')).toBe('/');
	});

	it('rejects encoded control chars regardless of case or position', () => {
		expect(safeRedirectPath('/app%00', '/')).toBe('/');
		expect(safeRedirectPath('/app%0D%0A', '/')).toBe('/');
		expect(safeRedirectPath('/app?x=%0a', '/')).toBe('/');
		expect(safeRedirectPath('/app#%0d', '/')).toBe('/');
	});

	it('decodes only once, leaving double-encoded sequences literal', () => {
		// %25%30%64 decodes once to the literal text "%0d", not a CR; the value
		// is a same-origin path and is preserved verbatim (the consumer never
		// decodes a second time).
		expect(safeRedirectPath('/x%25%30%64', '/')).toBe('/x%25%30%64');
	});

	it('rejects scheme-relative targets that resolve cross-origin', () => {
		// A leading scheme with no authority slashes slips a naive `//` check yet
		// navigates to http://evil.com/ from an https origin.
		expect(safeRedirectPath('http:evil.com', '/')).toBe('/');
		expect(safeRedirectPath('http:/evil.com', '/')).toBe('/');
		expect(safeRedirectPath('http:\\evil.com', '/')).toBe('/');
	});

	it('rejects an absolute URL whose host matches the sentinel origin', () => {
		expect(safeRedirectPath('http://redirect.invalid/x', '/')).toBe('/');
	});

	it('rejects embedded credentials in the authority', () => {
		expect(safeRedirectPath('//user:pass@redirect.invalid/x', '/')).toBe('/');
	});

	it('canonicalizes the accepted path so check and use agree', () => {
		expect(safeRedirectPath('/a/../b', '/')).toBe('/b');
		expect(safeRedirectPath('/café?q=hello world#x y', '/')).toBe(
			'/caf%C3%A9?q=hello%20world#x%20y'
		);
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
