import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPlatform, sanitizeBranchAlias } from './platform';

describe('sanitizeBranchAlias', () => {
	it('uses the full alias budget for short worker names', () => {
		const workerName = 'myapp'; // 5 chars, budget 57
		const longBranch = 'a'.repeat(80);
		const alias = sanitizeBranchAlias(longBranch, workerName);
		expect(alias.length).toBe(57);
		expect(`${alias}-${workerName}`.length).toBeLessThanOrEqual(63);
	});

	it('shrinks alias budget for long worker names', () => {
		const workerName = 'my-cool-saas-product'; // 20 chars, budget 42
		const longBranch = 'a'.repeat(80);
		const alias = sanitizeBranchAlias(longBranch, workerName);
		expect(alias.length).toBe(42);
		expect(`${alias}-${workerName}`.length).toBeLessThanOrEqual(63);
	});

	it('keeps digit-leading branches valid even with long worker names', () => {
		const workerName = 'my-cool-saas-product'; // 20 chars, budget 42
		const alias = sanitizeBranchAlias('123-feature-branch', workerName);
		expect(alias.startsWith('b-1')).toBe(true);
		expect(alias).toMatch(/^[a-z]/);
		expect(`${alias}-${workerName}`.length).toBeLessThanOrEqual(63);
	});

	it('falls back to "branch" for an empty branch name', () => {
		expect(sanitizeBranchAlias('', 'myapp')).toBe('branch');
	});

	it('falls back to "branch" for an all-punctuation branch name', () => {
		expect(sanitizeBranchAlias('---', 'myapp')).toBe('branch');
	});

	it('throws when the worker name leaves a budget below the fallback length', () => {
		const tooLong = 'a'.repeat(57); // budget = 5, fallback "branch" is 6
		expect(() => sanitizeBranchAlias('feature', tooLong)).toThrow(/leaves only 5 chars/);
	});

	it('accepts a worker name that leaves a budget exactly equal to the fallback length', () => {
		const justFits = 'a'.repeat(56); // budget = 6, exactly fits "branch"
		expect(sanitizeBranchAlias('', justFits)).toBe('branch');
	});

	it('trims trailing dash introduced by truncation', () => {
		const workerName = 'myapp';
		// 56-char branch ending with chars that will keep a dash at slice boundary
		const branch = 'a'.repeat(56) + '-tail';
		const alias = sanitizeBranchAlias(branch, workerName);
		expect(alias.endsWith('-')).toBe(false);
	});
});

describe('detectPlatform (Vercel)', () => {
	// detectPlatform reads process.env, so isolate the vars it touches
	const vars = [
		'VERCEL',
		'VERCEL_ENV',
		'VERCEL_URL',
		'VERCEL_PROJECT_PRODUCTION_URL',
		'VERCEL_GIT_COMMIT_REF'
	] as const;
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const key of vars) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
		process.env.VERCEL = '1';
		process.env.VERCEL_URL = 'myapp-abc123xyz.vercel.app';
	});

	afterEach(() => {
		for (const key of vars) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it('prefers the production domain over the deployment URL for production builds', () => {
		process.env.VERCEL_ENV = 'production';
		process.env.VERCEL_PROJECT_PRODUCTION_URL = 'myapp.vercel.app';
		const platform = detectPlatform();
		expect(platform.siteUrl).toBe('https://myapp.vercel.app');
		expect(platform.deployUrl).toBe('myapp-abc123xyz.vercel.app');
	});

	it('falls back to the deployment URL for production when no production domain is set', () => {
		process.env.VERCEL_ENV = 'production';
		const platform = detectPlatform();
		expect(platform.siteUrl).toBe('https://myapp-abc123xyz.vercel.app');
	});

	it('uses the deployment URL for previews even when a production domain is set', () => {
		process.env.VERCEL_ENV = 'preview';
		process.env.VERCEL_PROJECT_PRODUCTION_URL = 'myapp.vercel.app';
		const platform = detectPlatform();
		expect(platform.siteUrl).toBe('https://myapp-abc123xyz.vercel.app');
		expect(platform.isPreview).toBe(true);
	});

	it('returns null siteUrl when no Vercel URL is available', () => {
		process.env.VERCEL_ENV = 'production';
		delete process.env.VERCEL_URL;
		const platform = detectPlatform();
		expect(platform.siteUrl).toBeNull();
	});
});

describe('detectPlatform (Cloudflare)', () => {
	const vars = [
		'VERCEL',
		'WORKERS_CI',
		'WORKERS_CI_BRANCH',
		'WORKERS_NAME',
		'WORKERS_SUBDOMAIN',
		'CF_PAGES',
		'CF_PAGES_BRANCH',
		'CF_PAGES_URL',
		'PRODUCTION_BRANCH',
		'PUBLIC_SITE_URL',
		'SITE_URL'
	] as const;
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const key of vars) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
		process.env.PRODUCTION_BRANCH = 'main';
	});

	afterEach(() => {
		for (const key of vars) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it('uses a custom domain for a Pages production build', () => {
		process.env.CF_PAGES = '1';
		process.env.CF_PAGES_BRANCH = 'main';
		process.env.CF_PAGES_URL = 'https://generated.pages.dev';
		process.env.SITE_URL = 'https://app.example.com';

		const platform = detectPlatform();
		expect(platform.siteUrl).toBe('https://app.example.com');
		expect(platform.deployUrl).toBe('https://generated.pages.dev');
	});

	it('uses the Pages deployment URL for a preview despite inherited production values', () => {
		process.env.CF_PAGES = '1';
		process.env.CF_PAGES_BRANCH = 'feature/test';
		process.env.CF_PAGES_URL = 'https://feature-test.pages.dev';
		process.env.PUBLIC_SITE_URL = 'https://app.example.com';
		process.env.SITE_URL = 'https://app.example.com';

		const platform = detectPlatform();
		expect(platform.isPreview).toBe(true);
		expect(platform.siteUrl).toBe('https://feature-test.pages.dev');
	});

	it('constructs a Workers preview alias without using the production origin', () => {
		process.env.WORKERS_CI = '1';
		process.env.WORKERS_CI_BRANCH = 'feature/Agent Surface';
		process.env.WORKERS_NAME = 'myapp';
		process.env.WORKERS_SUBDOMAIN = 'account';
		process.env.SITE_URL = 'https://app.example.com';

		const platform = detectPlatform();
		expect(platform.siteUrl).toBe('https://feature-agent-surface-myapp.account.workers.dev');
	});

	it('falls back to the generated Workers production host', () => {
		process.env.WORKERS_CI = '1';
		process.env.WORKERS_CI_BRANCH = 'main';
		process.env.WORKERS_NAME = 'myapp';
		process.env.WORKERS_SUBDOMAIN = 'account';

		expect(detectPlatform().siteUrl).toBe('https://myapp.account.workers.dev');
	});
});
