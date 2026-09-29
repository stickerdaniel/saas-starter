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
