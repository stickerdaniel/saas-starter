import { describe, expect, it } from 'vitest';
import { resolveBuildSiteOrigin } from './build';

describe('resolveBuildSiteOrigin', () => {
	it('uses the local preview origin for a direct build', () => {
		expect(resolveBuildSiteOrigin({})).toBe('http://localhost:4173');
	});

	it('normalizes an explicit frontend origin', () => {
		expect(resolveBuildSiteOrigin({ PUBLIC_SITE_URL: 'https://app.example.com/' })).toBe(
			'https://app.example.com'
		);
	});

	it('accepts the compatible SITE_URL input', () => {
		expect(resolveBuildSiteOrigin({ SITE_URL: 'https://app.example.com/' })).toBe(
			'https://app.example.com'
		);
	});

	it('rejects conflicting frontend origins', () => {
		expect(() =>
			resolveBuildSiteOrigin({
				PUBLIC_SITE_URL: 'https://one.example.com',
				SITE_URL: 'https://two.example.com'
			})
		).toThrow(/conflicts with SITE_URL/);
	});

	it('requires an explicit origin for adapter-node production', () => {
		expect(() => resolveBuildSiteOrigin({ NODE_ADAPTER: '1' })).toThrow(
			/PUBLIC_SITE_URL is required/
		);
	});
});
