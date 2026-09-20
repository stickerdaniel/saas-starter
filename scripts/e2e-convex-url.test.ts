// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invalidateLocalTestBackendUrl, waitForConvexUrl } from '../e2e/utils/convex-url';

const ENV_KEYS = [
	'VARLOCK_ENV',
	'CI',
	'E2E_OVERRIDE_SITE_URL',
	'PUBLIC_CONVEX_URL',
	'VITE_CONVEX_URL'
];

function useOwnedLocalTestBackend(): void {
	process.env.VARLOCK_ENV = 'test';
}

describe('waitForConvexUrl', () => {
	let saved: Record<string, string | undefined>;
	const tempDirs: string[] = [];

	beforeEach(() => {
		saved = {};
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it('invalidates a stale publication before waiting for the current backend', async () => {
		useOwnedLocalTestBackend();
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-starter-e2e-convex-url-'));
		tempDirs.push(cwd);
		const convexDir = path.join(cwd, '.convex');
		const publication = path.join(convexDir, '.test-backend-url');
		fs.mkdirSync(convexDir);
		fs.writeFileSync(publication, 'http://localhost:1111');

		invalidateLocalTestBackendUrl(cwd);
		let attempts = 0;
		const resolveLocalTest = () => {
			attempts += 1;
			if (attempts === 2) fs.writeFileSync(publication, 'http://localhost:2222');
			return fs.existsSync(publication) ? fs.readFileSync(publication, 'utf-8').trim() : undefined;
		};

		await expect(
			waitForConvexUrl({ timeoutMs: 1000, pollIntervalMs: 1, resolveLocalTest })
		).resolves.toBe('http://localhost:2222');
		expect(attempts).toBe(2);
	});

	it.each([
		['environment URL', 'https://cloud.example.com'],
		['regular dev publication', 'http://localhost:3333']
	])('ignores a %s while waiting for the owned test backend', async (_label, fallbackUrl) => {
		useOwnedLocalTestBackend();
		let attempts = 0;

		await expect(
			waitForConvexUrl({
				timeoutMs: 1000,
				pollIntervalMs: 1,
				resolve: () => fallbackUrl,
				resolveLocalTest: () => (++attempts < 2 ? undefined : 'http://localhost:4444')
			})
		).resolves.toBe('http://localhost:4444');
		expect(attempts).toBe(2);
	});

	it.each([
		[
			'a caller-managed preview',
			() => (process.env.E2E_OVERRIDE_SITE_URL = 'https://preview.example.com')
		],
		['a cloud CI run', () => (process.env.CI = '1')]
	])('uses generic resolution immediately for %s', async (_label, configure) => {
		process.env.VARLOCK_ENV = 'test';
		configure();
		let attempts = 0;

		await expect(
			waitForConvexUrl({
				resolve: () => {
					attempts += 1;
					return 'https://convex.example.com';
				},
				resolveLocalTest: () => {
					throw new Error('caller-managed setup must not read the local publication');
				}
			})
		).resolves.toBe('https://convex.example.com');
		expect(attempts).toBe(1);
	});
});
