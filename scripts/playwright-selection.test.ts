// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type ListedSuite = {
	specs?: Array<{ tests: Array<{ projectName: string }> }>;
	suites?: ListedSuite[];
};

function projects(suites: ListedSuite[]): string[] {
	return suites.flatMap((suite) => [
		...(suite.specs ?? []).flatMap((spec) => spec.tests.map((test) => test.projectName)),
		...projects(suite.suites ?? [])
	]);
}

describe('independent Playwright project selection', () => {
	it('collects only signout when signout is requested', () => {
		// Listing uses the actual config and dependency expansion without starting
		// a browser or backend. A chromium dependency silently replays that suite.
		const result = spawnSync(
			'bun',
			['run', 'test:e2e', '--list', '--project=chromium-signout', '--reporter=json'],
			{ encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
		);
		expect(result.status, result.stderr).toBe(0);
		const report = JSON.parse(result.stdout) as { suites: ListedSuite[] };
		expect(new Set(projects(report.suites))).toEqual(new Set(['chromium-signout']));
	}, 65_000);
});

// Exercise native collection; IDs come from Playwright, rather than a filename list.
import { cases, type Report } from './e2e-ci';
function collect(lane: string, args: string[] = []) {
	const result = spawnSync('bun', ['run', 'test:e2e', '--list', '--reporter=json', ...args], {
		encoding: 'utf8',
		timeout: 60_000,
		maxBuffer: 4 * 1024 * 1024,
		env: {
			...process.env,
			CI: 'true',
			PUBLIC_SITE_URL: 'https://preview.example.com',
			E2E_LANE: lane
		}
	});
	expect(result.status, result.stderr).toBe(0);
	return cases(JSON.parse(result.stdout) as Report);
}
it('partitions the complete suite with native public shards and one exclusive lane', () => {
	const full = collect('full');
	const exclusive = collect('exclusive');
	for (const count of [2, 3]) {
		const union = new Set(exclusive.keys());
		for (let index = 1; index <= count; index++) {
			const shard = collect('public', [`--shard=${index}/${count}`]);
			expect(shard.size).toBeGreaterThan(0);
			for (const id of shard.keys()) {
				expect(union.has(id)).toBe(false);
				union.add(id);
			}
		}
		expect(union).toEqual(new Set(full.keys()));
	}
}, 120_000);
it.each([['--shard=1/2'], ['--shard', '1/2']])(
	'rejects unsafe mutating sharding %s before setup',
	(...args) => {
		const result = spawnSync('bun', ['run', 'test:e2e', '--list', ...args], {
			encoding: 'utf8',
			timeout: 30_000,
			env: { ...process.env, E2E_LANE: 'full' }
		});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Native sharding requires E2E_LANE=public');
	}
);

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it('executes public coverage without account setup or teardown credentials', () => {
	const directory = mkdtempSync(join(tmpdir(), 'public-lifecycle-'));
	const fixture = join(process.cwd(), 'e2e', 'public-lifecycle-probe.spec.ts');
	try {
		writeFileSync(
			fixture,
			"import { test, expect } from '@playwright/test'; test('secretless public lane', () => { expect(process.env.AUTH_E2E_TEST_SECRET || '').toBe(''); });"
		);
		const result = spawnSync(
			'bun',
			['run', 'test:e2e', 'public-lifecycle-probe.spec.ts', '--reporter=json'],
			{
				encoding: 'utf8',
				timeout: 30_000,
				env: {
					...process.env,
					CI: 'true',
					PUBLIC_SITE_URL: 'https://preview.example.com',
					PUBLIC_CONVEX_URL: 'http://127.0.0.1:1',
					AUTH_E2E_TEST_SECRET: '',
					E2E_LANE: 'public',
					PLAYWRIGHT_JSON_OUTPUT_NAME: join(directory, 'report.json')
				}
			}
		);
		expect(result.status, result.stderr).toBe(0);
	} finally {
		rmSync(fixture, { force: true });
		rmSync(directory, { recursive: true, force: true });
	}
}, 35_000);
