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
	// computeBuildEnv spreads process.env, so isolate the vars it touches
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

	it('sets PUBLIC_SITE_URL from platform.siteUrl when unset', () => {
		const buildEnv = computeBuildEnv(makePlatform(), deployment);
		expect(buildEnv.PUBLIC_SITE_URL).toBe('https://myapp.example.workers.dev');
	});

	it('does not overwrite an explicitly set PUBLIC_SITE_URL', () => {
		process.env.PUBLIC_SITE_URL = 'https://custom-domain.example.com';
		const buildEnv = computeBuildEnv(makePlatform(), deployment);
		expect(buildEnv.PUBLIC_SITE_URL).toBe('https://custom-domain.example.com');
	});

	it('leaves PUBLIC_SITE_URL unset when platform.siteUrl is null', () => {
		const buildEnv = computeBuildEnv(makePlatform({ siteUrl: null }), deployment);
		expect(buildEnv.PUBLIC_SITE_URL).toBeUndefined();
	});

	it('sets PUBLIC_SITE_URL for preview deployments alongside SITE_URL', () => {
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
});

describe('deployment-key fallback in the invocation environment', () => {
	it.each([
		['prod:backend-123|fixture-key', 'backend-123'],
		['backend-123.eu-west-1|fixture-key', 'backend-123.eu-west-1'],
		['invalid-no-delimiter', null],
		['|fixture-key', null],
		['', null]
	])('preserves the existing fallback for %s', (key, slug) => {
		const env = { CONVEX_DEPLOY_KEY: key ?? '', __VARLOCK_ENV: 'manifest' };
		const result = computeBuildEnv(makePlatform(), { urlSlug: null, name: null }, env);
		expect(result.PUBLIC_CONVEX_URL).toBe(slug ? `https://${slug}.convex.cloud` : undefined);
		expect(result).not.toHaveProperty('__VARLOCK_ENV');
		expect(env.__VARLOCK_ENV).toBe('manifest');
	});
});
