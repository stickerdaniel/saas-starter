import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	loadBuildEnvironment,
	resolveBuildSiteOrigin,
	viteBuildCommand,
	viteBuildMode
} from './build';

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
		{ CF_PAGES: '1', CF_PAGES_BRANCH: 'main' },
		{ NETLIFY: 'true' },
		{ GITHUB_ACTION_REPOSITORY: 'Azure/static-web-apps-deploy' },
		{ SST: '1' },
		{ GCP_BUILDPACKS: '1' }
	])(
		'requires an explicit origin for the hosted environment $NODE_ADAPTER$VERCEL$WORKERS_CI$CF_PAGES',
		(env) => {
			expect(() => resolveBuildSiteOrigin(env)).toThrow(/PUBLIC_SITE_URL is required/);
		}
	);

	it.each([
		{ args: [], expected: 'production' },
		{ args: ['--mode', 'staging'], expected: 'staging' },
		{ args: ['-m', 'staging'], expected: 'staging' },
		{ args: ['-m=staging'], expected: 'staging' },
		{ args: ['--mode', 'staging', '--mode=production'], expected: 'production' },
		{ args: ['-m', 'staging', '--mode', 'production'], expected: 'production' },
		{ args: ['--mode=preview'], expected: 'preview' }
	])('reads the Vite mode from $args', ({ args, expected }) => {
		expect(viteBuildMode(args)).toBe(expected);
	});

	it('loads the selected mode environment before resolving the origin', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'site-build-env-'));
		const savedPublicOrigin = process.env.PUBLIC_SITE_URL;
		const savedCompatibleOrigin = process.env.SITE_URL;
		delete process.env.PUBLIC_SITE_URL;
		delete process.env.SITE_URL;
		try {
			fs.writeFileSync(
				path.join(directory, '.env.staging'),
				'PUBLIC_SITE_URL=https://staging.example.com\n'
			);
			expect(loadBuildEnvironment(['--mode', 'staging'], {}, directory).PUBLIC_SITE_URL).toBe(
				'https://staging.example.com'
			);
			expect(
				loadBuildEnvironment(
					['--mode', 'staging'],
					{ PUBLIC_SITE_URL: 'https://process.example.com' },
					directory
				).PUBLIC_SITE_URL
			).toBe('https://process.example.com');
		} finally {
			if (savedPublicOrigin === undefined) delete process.env.PUBLIC_SITE_URL;
			else process.env.PUBLIC_SITE_URL = savedPublicOrigin;
			if (savedCompatibleOrigin === undefined) delete process.env.SITE_URL;
			else process.env.SITE_URL = savedCompatibleOrigin;
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

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
