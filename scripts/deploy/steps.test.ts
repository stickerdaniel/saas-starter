import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, type PlatformContext } from './platform';
import {
	computeBuildEnv,
	deployConvex,
	prepareAiChatHistory,
	resolveDeploymentSiteOrigin,
	setProductionCapabilityProfile,
	setupPreviewEnv,
	validateConvexEnv,
	writeE2eConfig,
	type ConvexDeployment
} from './steps';
import { harness } from './__fixtures__/execution';

const deployment: ConvexDeployment = {
	urlSlug: 'curious-lark-703.eu-west-1',
	name: 'curious-lark-703'
};

describe('AI history migration preflight', () => {
	afterEach(() => vi.useRealTimers());
	it('uses the returned deployment target instead of the shell target', async () => {
		const h = harness({ CONVEX_DEPLOYMENT: 'dev:wrong-target' });
		await prepareAiChatHistory(deployment, h.execution);
		expect(h.events).toEqual([
			'bunx convex run --deployment-name curious-lark-703 aiChat/activityMigration:start'
		]);
	});
	it('rejects a missing target before executing any command', async () => {
		const h = harness();
		await expect(prepareAiChatHistory({ name: null, urlSlug: null }, h.execution)).rejects.toThrow(
			'requires the deployed'
		);
		expect(h.events).toEqual([]);
	});
	it.each([
		'not json',
		'null',
		'{"version":2,"status":"complete"}',
		'{"version":1,"status":"complete"}',
		'{"version":1,"status":"unknown"}'
	])('blocks a build on invalid progress %s', async (stdout) => {
		const h = harness({}, () => ({ stdout }));
		await expect(prepareAiChatHistory(deployment, h.execution)).rejects.toThrow(/progress/);
	});
	it('blocks a build on a command failure', async () => {
		const h = harness({}, () => ({ exitCode: 1 }));
		await expect(prepareAiChatHistory(deployment, h.execution)).rejects.toThrow('preflight failed');
	});
	it('waits for running progress, then accepts completion', async () => {
		vi.useFakeTimers();
		let calls = 0;
		const h = harness({}, () => ({
			stdout: JSON.stringify({
				version: 1,
				status: ++calls === 1 ? 'running' : 'complete',
				processed: 205
			})
		}));
		const pending = prepareAiChatHistory(deployment, h.execution);
		await vi.runAllTimersAsync();
		await pending;
		expect(h.events[1]).toBe(
			'bunx convex run --deployment-name curious-lark-703 aiChat/activityMigration:status'
		);
	});
	it('blocks a build when bounded polling cannot confirm completion', async () => {
		vi.useFakeTimers();
		const h = harness({}, () => ({
			stdout: JSON.stringify({ version: 1, status: 'running', processed: 100 })
		}));
		const result = expect(prepareAiChatHistory(deployment, h.execution)).rejects.toThrow(
			'has not completed'
		);
		await vi.runAllTimersAsync();
		await result;
		expect(h.events).toHaveLength(40);
	});
});

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

describe('preview E2E metadata', () => {
	afterEach(() => vi.restoreAllMocks());

	function written(env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
		vi.spyOn(fs, 'existsSync').mockReturnValue(true);
		const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const platform = detectPlatform(env);
		if (platform.isPreview) writeE2eConfig(platform, computeBuildEnv(platform, deployment, env));
		else writeE2eConfig(platform, { ...env, PUBLIC_CONVEX_URL: 'https://prod.convex.cloud' });
		const call = write.mock.calls.find(([path]) => String(path).endsWith('e2e-config.json'));
		return call && JSON.parse(String(call[1]));
	}

	it('records the Workers build that produced the preview', () => {
		expect(
			written({
				WORKERS_CI: '1',
				WORKERS_CI_BRANCH: 'feature',
				WORKERS_CI_COMMIT_SHA: 'a'.repeat(40),
				WORKERS_CI_BUILD_UUID: '7328cbfd-a523-4f33-ba5b-4382f4393713',
				WORKERS_NAME: 'myapp',
				WORKERS_SUBDOMAIN: 'example'
			})
		).toMatchObject({
			convexUrl: 'https://curious-lark-703.eu-west-1.convex.cloud',
			convexSiteUrl: 'https://curious-lark-703.eu-west-1.convex.site',
			sourceSha: 'a'.repeat(40),
			buildUuid: '7328cbfd-a523-4f33-ba5b-4382f4393713'
		});
	});

	it('keeps other preview providers valid without a Workers build UUID', () => {
		const config = written({
			VERCEL: '1',
			VERCEL_ENV: 'preview',
			VERCEL_URL: 'myapp-git-feature.vercel.app',
			VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40),
			WORKERS_CI_BUILD_UUID: ''
		});
		expect(config).toMatchObject({
			convexUrl: 'https://curious-lark-703.eu-west-1.convex.cloud',
			sourceSha: 'b'.repeat(40)
		});
		expect(config).not.toHaveProperty('buildUuid');
	});

	it('writes no metadata for production builds', () => {
		expect(written({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' })).toBeUndefined();
	});
});

describe('resolveDeploymentSiteOrigin', () => {
	it('rejects a production PUBLIC_SITE_URL that conflicts with SITE_URL', () => {
		expect(() =>
			resolveDeploymentSiteOrigin(makePlatform(), {
				PUBLIC_SITE_URL: 'https://one.example.com',
				SITE_URL: 'https://two.example.com'
			})
		).toThrow(/conflicts with SITE_URL/);
	});

	it('ignores inherited production origins for a preview', () => {
		expect(
			resolveDeploymentSiteOrigin(
				makePlatform({
					isPreview: true,
					environment: 'preview',
					siteUrl: 'https://preview.example.com'
				}),
				{ PUBLIC_SITE_URL: 'not a url', SITE_URL: 'https://production.example.com' }
			)
		).toBe('https://preview.example.com');
	});
});

describe('deployment capability profile ownership', () => {
	it('scopes production profile setup and validation to the production deployment', async () => {
		const platform = makePlatform();
		const setup = harness();
		const validation = harness();

		await setProductionCapabilityProfile(platform, setup.execution);
		await validateConvexEnv(platform, undefined, validation.execution);

		expect(setup.spawn.mock.calls.map(([request]) => request.args)).toEqual([
			['convex', 'env', 'set', 'CAPABILITY_PROFILE', 'production', '--prod']
		]);
		expect(validation.spawn.mock.calls.map(([request]) => request.args)).toEqual([
			['convex', 'env', 'list', '--prod']
		]);
	});

	it('keeps preview profile setup deployment-scoped before validation and seeding', async () => {
		const h = harness();
		const platform = makePlatform({
			environment: 'preview',
			isPreview: true,
			siteUrl: 'https://preview.example.test'
		});

		await setupPreviewEnv(deployment, platform, h.execution);

		const commands = h.spawn.mock.calls.map(([request]) => request.args);
		expect(commands.slice(0, 2)).toEqual([
			[
				'convex',
				'env',
				'set',
				'--deployment-name',
				deployment.name,
				'CAPABILITY_PROFILE',
				'preview'
			],
			[
				'convex',
				'env',
				'set',
				'--deployment-name',
				deployment.name,
				'SITE_URL',
				'https://preview.example.test'
			]
		]);
		const reads = commands.slice(2, -1);
		expect(reads.length).toBeGreaterThan(0);
		for (const read of reads) {
			expect(read).toEqual(['convex', 'env', 'list', '--deployment-name', deployment.name]);
		}
		expect(commands.at(-1)).toEqual([
			'convex',
			'run',
			'--deployment-name',
			deployment.name,
			'previewDev:ensurePreviewAdmin'
		]);
	});
});

describe('deployConvex Cloudflare environment', () => {
	const vars = [
		'VERCEL',
		'NETLIFY',
		'CF_PAGES',
		'CF_PAGES_BRANCH',
		'WORKERS_CI',
		'WORKERS_CI_BRANCH',
		'PRODUCTION_BRANCH',
		'CONVEX_DEPLOY_KEY',
		'CONVEX_PREVIEW_DEPLOY_KEY'
	] as const;
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const key of vars) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of vars) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it.each([
		{
			name: 'Workers Builds',
			env: {
				CF_PAGES: '',
				CF_PAGES_BRANCH: '',
				WORKERS_CI: '1',
				WORKERS_CI_BRANCH: 'production'
			},
			branchKey: 'WORKERS_CI_BRANCH'
		},
		{
			name: 'Cloudflare Pages',
			env: {
				CF_PAGES: '1',
				CF_PAGES_BRANCH: 'production',
				WORKERS_CI: '',
				WORKERS_CI_BRANCH: ''
			},
			branchKey: 'CF_PAGES_BRANCH'
		}
	])(
		'passes a Convex-compatible custom production branch for $name',
		async ({ env, branchKey }) => {
			Object.assign(process.env, env, { PRODUCTION_BRANCH: 'production' });
			const platform = detectPlatform();
			expect(platform.environment).toBe('production');
			expect(platform.isPreview).toBe(false);

			const h = harness({ ...process.env });
			await deployConvex(platform, h.execution);

			expect(h.spawn).toHaveBeenCalledTimes(1);
			const request = h.spawn.mock.calls[0]![0];
			expect(request.command).toBe('bunx');
			expect(request.args).toEqual(['convex', 'deploy']);
			expect(request.env?.[branchKey]).toBe('main');
			expect(process.env[branchKey]).toBe('production');
		}
	);

	it.each([
		{
			name: 'Workers Builds without a branch',
			env: {
				CF_PAGES: '',
				CF_PAGES_BRANCH: '',
				WORKERS_CI: '1'
			},
			branchKey: 'WORKERS_CI_BRANCH'
		},
		{
			name: 'Cloudflare Pages with an empty branch',
			env: {
				CF_PAGES: '1',
				CF_PAGES_BRANCH: '',
				WORKERS_CI: '',
				WORKERS_CI_BRANCH: ''
			},
			branchKey: 'CF_PAGES_BRANCH'
		}
	])('keeps $name fail-closed for Convex', async ({ env, branchKey }) => {
		Object.assign(process.env, env, {
			PRODUCTION_BRANCH: 'production',
			CONVEX_DEPLOY_KEY: 'prod:key'
		});
		const platform = detectPlatform();
		expect(platform.gitRef).toBeNull();
		expect(platform.environment).toBe('production');
		expect(platform.isPreview).toBe(false);

		const h = harness({ ...process.env });
		await deployConvex(platform, h.execution);

		expect(h.spawn).toHaveBeenCalledTimes(1);
		const request = h.spawn.mock.calls[0]![0];
		expect(request.command).toBe('bunx');
		expect(request.args).toEqual(['convex', 'deploy']);
		expect(request.env?.[branchKey]).not.toBe('main');
		expect(process.env[branchKey]).not.toBe('main');
	});

	it.each([
		{
			name: 'Workers Builds',
			env: {
				CF_PAGES: '',
				CF_PAGES_BRANCH: '',
				WORKERS_CI: '1',
				WORKERS_CI_BRANCH: 'feature/workers'
			},
			branchKey: 'WORKERS_CI_BRANCH'
		},
		{
			name: 'Cloudflare Pages',
			env: {
				CF_PAGES: '1',
				CF_PAGES_BRANCH: 'feature/pages',
				WORKERS_CI: '',
				WORKERS_CI_BRANCH: ''
			},
			branchKey: 'CF_PAGES_BRANCH'
		}
	])('keeps $name preview branches non-production for Convex', async ({ env, branchKey }) => {
		Object.assign(process.env, env, {
			PRODUCTION_BRANCH: 'production',
			CONVEX_DEPLOY_KEY: 'prod:key',
			CONVEX_PREVIEW_DEPLOY_KEY: 'preview:key'
		});
		const originalBranch = process.env[branchKey];
		const platform = detectPlatform();
		expect(platform.environment).toBe('preview');
		expect(platform.isPreview).toBe(true);

		const h = harness({ ...process.env });
		await deployConvex(platform, h.execution);

		expect(h.spawn).toHaveBeenCalledTimes(1);
		const request = h.spawn.mock.calls[0]![0];
		expect(request.command).toBe('bunx');
		expect(request.args).toEqual(['convex', 'deploy', '--preview-create', originalBranch]);
		expect(request.env?.[branchKey]).toBe(originalBranch);
		expect(process.env[branchKey]).toBe(originalBranch);
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
