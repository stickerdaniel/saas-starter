import { describe, expect, it } from 'vitest';
import { resolveBuildSiteOrigin, viteBuildCommand } from './build';

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

	it.each([
		{ NODE_ADAPTER: '1' },
		{ VERCEL: '1', VERCEL_ENV: 'production' },
		{ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' },
		{ CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }
	])(
		'requires an explicit origin for the hosted environment $NODE_ADAPTER$VERCEL$WORKERS_CI$CF_PAGES',
		(env) => {
			expect(() => resolveBuildSiteOrigin(env)).toThrow(/PUBLIC_SITE_URL is required/);
		}
	);

	it('forwards Vite build arguments unchanged', () => {
		expect(viteBuildCommand(['--mode', 'staging', '--sourcemap'])).toEqual([
			'vite',
			'build',
			'--mode',
			'staging',
			'--sourcemap'
		]);
	});
});
