import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformContext } from './platform';
import { computeBuildEnv, type ConvexDeployment } from './steps';

const deployment: ConvexDeployment = {
	urlSlug: 'curious-lark-703.eu-west-1',
	name: 'curious-lark-703'
};

function makePlatform(overrides: Partial<PlatformContext> = {}): PlatformContext {
	return {
		platform: 'cloudflare',
		environment: 'production',
		deployUrl: null,
		gitRef: 'main',
		isPreview: false,
		siteUrl: 'https://myapp.example.workers.dev',
		...overrides
	};
}

describe('computeBuildEnv', () => {
	const savedPublicSiteUrl = process.env.PUBLIC_SITE_URL;
	const savedSiteUrl = process.env.SITE_URL;

	beforeEach(() => {
		delete process.env.PUBLIC_SITE_URL;
		delete process.env.SITE_URL;
	});

	afterEach(() => {
		if (savedPublicSiteUrl === undefined) delete process.env.PUBLIC_SITE_URL;
		else process.env.PUBLIC_SITE_URL = savedPublicSiteUrl;
		if (savedSiteUrl === undefined) delete process.env.SITE_URL;
		else process.env.SITE_URL = savedSiteUrl;
	});

	it('uses the stable platform origin for production', () => {
		const buildEnv = computeBuildEnv(makePlatform(), deployment);
		expect(buildEnv.PUBLIC_SITE_URL).toBe('https://myapp.example.workers.dev');
	});

	it('prefers an explicit PUBLIC_SITE_URL in production', () => {
		process.env.PUBLIC_SITE_URL = 'https://custom-domain.example.com/';
		const buildEnv = computeBuildEnv(makePlatform(), deployment);
		expect(buildEnv.PUBLIC_SITE_URL).toBe('https://custom-domain.example.com');
	});

	it('maps the compatible SITE_URL input to PUBLIC_SITE_URL', () => {
		process.env.SITE_URL = 'https://custom-domain.example.com/';
		const buildEnv = computeBuildEnv(makePlatform({ siteUrl: null }), deployment);
		expect(buildEnv.PUBLIC_SITE_URL).toBe('https://custom-domain.example.com');
	});

	it('rejects conflicting production origins', () => {
		process.env.PUBLIC_SITE_URL = 'https://one.example.com';
		process.env.SITE_URL = 'https://two.example.com';
		expect(() => computeBuildEnv(makePlatform(), deployment)).toThrow(/conflicts with SITE_URL/);
	});

	it('requires a derivable production origin', () => {
		expect(() => computeBuildEnv(makePlatform({ siteUrl: null }), deployment)).toThrow(
			/Production builds require/
		);
	});

	it('overrides inherited production origins for previews', () => {
		process.env.PUBLIC_SITE_URL = 'https://production.example.com';
		process.env.SITE_URL = 'https://production.example.com';
		const buildEnv = computeBuildEnv(
			makePlatform({
				environment: 'preview',
				isPreview: true,
				siteUrl: 'https://branch-myapp.example.workers.dev'
			}),
			deployment
		);
		expect(buildEnv.SITE_URL).toBe('https://branch-myapp.example.workers.dev');
		expect(buildEnv.PUBLIC_SITE_URL).toBe('https://branch-myapp.example.workers.dev');
	});

	it('requires a platform URL for previews', () => {
		expect(() =>
			computeBuildEnv(
				makePlatform({ environment: 'preview', isPreview: true, siteUrl: null }),
				deployment
			)
		).toThrow(/Preview builds require/);
	});
});
