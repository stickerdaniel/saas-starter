import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as vm from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPlatform, type PlatformContext } from './platform';
import {
	computeBuildEnv,
	deployConvex,
	resolveDeploymentSiteOrigin,
	type ConvexDeployment
} from './steps';
import * as deployUtils from './utils';

const deployment: ConvexDeployment = {
	urlSlug: 'curious-lark-703.eu-west-1',
	name: 'curious-lark-703'
};

const require = createRequire(import.meta.url);
const convexPackagePath = require.resolve('convex/package.json');
const convexCliPath = path.resolve(path.dirname(convexPackagePath), 'dist/cli.bundle.cjs');

function convexProductionClassifier(): string {
	const source = ts.createSourceFile(
		convexCliPath,
		fs.readFileSync(convexCliPath, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	let classifier: ts.FunctionDeclaration | undefined;
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === 'isNonProdBuildEnvironment') {
			classifier = node;
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	if (!classifier) throw new Error(`Convex production classifier not found in ${convexCliPath}`);
	return classifier.getText(source);
}

const convexClassifier = new vm.Script(`(${convexProductionClassifier()})()`);

function convexTreatsAsNonProduction(env: NodeJS.ProcessEnv): boolean {
	return convexClassifier.runInNewContext({ process: { env } }) as boolean;
}

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

	it('runs canonical-origin validation before remote deployment steps', () => {
		const source = fs.readFileSync(path.resolve('scripts/deploy.ts'), 'utf8');
		const preflight = source.indexOf('resolveDeploymentSiteOrigin(platform)');
		expect(preflight).toBeGreaterThanOrEqual(0);
		expect(preflight).toBeLessThan(source.indexOf('syncTranslations(platform)'));
		expect(preflight).toBeLessThan(source.indexOf('deployConvex(platform)'));
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

describe('resolveDeploymentSiteOrigin', () => {
	it('rejects conflicting origins before a deployment starts', () => {
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
	const runCommandCaptureMock = vi.spyOn(deployUtils, 'runCommandCapture');

	beforeEach(() => {
		for (const key of vars) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
		runCommandCaptureMock.mockReset().mockReturnValue({
			success: true,
			stdout: 'https://curious-lark-703.convex.cloud',
			stderr: ''
		});
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

			await deployConvex(platform);

			expect(runCommandCaptureMock).toHaveBeenCalledTimes(1);
			const [command, args, deployEnv] = runCommandCaptureMock.mock.calls[0]!;
			expect(command).toBe('bunx');
			expect(args).toEqual(['convex', 'deploy']);
			expect(deployEnv?.[branchKey]).toBe('main');
			expect(convexTreatsAsNonProduction(deployEnv!)).toBe(false);
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

		await deployConvex(platform);

		expect(runCommandCaptureMock).toHaveBeenCalledTimes(1);
		const [command, args, deployEnv] = runCommandCaptureMock.mock.calls[0]!;
		expect(command).toBe('bunx');
		expect(args).toEqual(['convex', 'deploy']);
		expect(deployEnv?.[branchKey]).not.toBe('main');
		expect(convexTreatsAsNonProduction(deployEnv!)).toBe(true);
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

		await deployConvex(platform);

		expect(runCommandCaptureMock).toHaveBeenCalledTimes(1);
		const [command, args, deployEnv] = runCommandCaptureMock.mock.calls[0]!;
		expect(command).toBe('bunx');
		expect(args).toEqual(['convex', 'deploy', '--preview-create', originalBranch]);
		expect(deployEnv?.[branchKey]).toBe(originalBranch);
		expect(convexTreatsAsNonProduction(deployEnv!)).toBe(true);
		expect(process.env[branchKey]).toBe(originalBranch);
	});
});
