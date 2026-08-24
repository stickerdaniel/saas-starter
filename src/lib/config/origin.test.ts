import { describe, expect, it } from 'vitest';
import { normalizeSiteOrigin, resolveConfiguredSiteOrigin } from './origin';

describe('site origin', () => {
	it('normalizes a root HTTP(S) URL', () => {
		expect(normalizeSiteOrigin('https://Example.COM:443/')).toBe('https://example.com');
		expect(normalizeSiteOrigin('http://localhost:5174/')).toBe('http://localhost:5174');
	});

	it.each([
		'not a URL',
		'ftp://example.com',
		'https://user:pass@example.com',
		'https://example.com/path',
		'https://example.com/?query=1',
		'https://example.com/#fragment'
	])('rejects a value that is not an origin: %s', (value) => {
		expect(() => normalizeSiteOrigin(value)).toThrow();
	});

	it('does not echo credential-bearing values in validation errors', () => {
		const value = 'https://deploy-user:secret-token@example.com';
		expect(() => normalizeSiteOrigin(value)).toThrow(
			/^Site origin must not contain credentials\.$/
		);
	});

	it('prefers the configured canonical origin over the request host', () => {
		expect(
			resolveConfiguredSiteOrigin('https://app.example.com/', 'https://preview.example.workers.dev')
		).toBe('https://app.example.com');
	});

	it('uses the request origin when no canonical origin is configured', () => {
		expect(resolveConfiguredSiteOrigin(undefined, 'http://localhost:5174')).toBe(
			'http://localhost:5174'
		);
	});

	it('fails prerendering without a configured canonical origin', () => {
		expect(() => resolveConfiguredSiteOrigin(undefined, 'http://sveltekit-prerender')).toThrow(
			/PUBLIC_SITE_URL is required/
		);
	});
});
