import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPreviewBypass } from '../e2e/utils/preview-bypass';

export function shardCount(value: string | undefined): number {
	if (value === undefined || value === '') return 1;
	if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 32)
		throw new Error('E2E_PUBLIC_SHARDS must be an integer from 1 to 32');
	return Number(value);
}
export function backendKey(url: string): string {
	const parsed = new URL(url);
	if (
		!['http:', 'https:'].includes(parsed.protocol) ||
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	)
		throw new Error('Expected a backend origin');
	return createHash('sha256').update(parsed.origin).digest('hex');
}
export function assertMetadata(
	version: unknown,
	config: unknown,
	expected: { sha: string; convexUrl: string; convexSiteUrl: string }
) {
	if (
		!version ||
		typeof version !== 'object' ||
		!('version' in version) ||
		version.version !== expected.sha
	)
		throw new Error('Preview revision changed or does not match the tested commit');
	if (
		!config ||
		typeof config !== 'object' ||
		!('convexUrl' in config) ||
		!('convexSiteUrl' in config) ||
		config.convexUrl !== expected.convexUrl ||
		config.convexSiteUrl !== expected.convexSiteUrl
	)
		throw new Error('Preview backend discovery changed');
	backendKey(expected.convexUrl);
	backendKey(expected.convexSiteUrl);
}

type TestResult = { status: string };
type Test = { projectName: string; expectedStatus: string; status: string; results: TestResult[] };
type Suite = { suites?: Suite[]; specs?: Array<{ id: string; tests: Test[] }> };
export type Report = { suites: Suite[]; errors?: unknown[] };
export function cases(report: Report): Map<string, Test> {
	const collected = new Map<string, Test>();
	function visit(suite: Suite) {
		for (const spec of suite.specs ?? [])
			for (const test of spec.tests) {
				const key = `${test.projectName}:${spec.id}`;
				if (collected.has(key)) throw new Error(`Duplicate case: ${key}`);
				collected.set(key, test);
			}
		for (const child of suite.suites ?? []) visit(child);
	}
	for (const suite of report.suites) visit(suite);
	return collected;
}
export function reconcile(
	inventory: Report,
	reports: Report[]
): { cases: number; skipped: number; retries: number } {
	const expected = cases(inventory);
	if (!expected.size || !reports.length)
		throw new Error('Missing E2E inventory or execution reports');
	const actual = new Map<string, Test>();
	for (const report of reports) {
		if (report.errors?.length) throw new Error('Playwright reported lifecycle or runner errors');
		const executed = cases(report);
		if (!executed.size) throw new Error('Empty E2E shard');
		for (const [key, test] of executed) {
			if (actual.has(key)) throw new Error(`Duplicate execution: ${key}`);
			if (!expected.has(key)) throw new Error(`Unexpected case: ${key}`);
			if (!test.results.length || !['expected', 'flaky', 'skipped'].includes(test.status))
				throw new Error(`Case did not pass: ${key}`);
			if (test.status === 'skipped' && test.expectedStatus !== 'skipped')
				throw new Error(`Unexplained skip: ${key}`);
			actual.set(key, test);
		}
	}
	for (const key of expected.keys())
		if (!actual.has(key)) throw new Error(`Missing execution: ${key}`);
	return {
		cases: actual.size,
		skipped: [...actual.values()].filter((test) => test.status === 'skipped').length,
		retries: [...actual.values()].reduce(
			(count, test) => count + Math.max(0, test.results.length - 1),
			0
		)
	};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const mode = process.argv[2];
	if (mode === 'prepare') {
		const count = shardCount(process.env.E2E_PUBLIC_SHARDS);
		const matrix = {
			shard: count === 1 ? [1] : Array.from({ length: count }, (_, index) => index + 1)
		};
		appendFileSync(
			process.env.GITHUB_OUTPUT!,
			`matrix=${JSON.stringify(matrix)}\ncount=${count}\nbackend-key=${backendKey(process.env.PUBLIC_CONVEX_URL!)}\n`
		);
	} else if (mode === 'check') {
		const headers = { ...getPreviewBypass().headers, 'cache-control': 'no-cache' };
		async function get(path: string) {
			const response = await fetch(new URL(path, process.env.PUBLIC_SITE_URL), {
				headers,
				signal: AbortSignal.timeout(20_000)
			});
			if (!response.ok) throw new Error(`Preview metadata HTTP ${response.status}: ${path}`);
			return response.json();
		}
		assertMetadata(await get('/_app/version.json'), await get('/.well-known/e2e-config.json'), {
			sha: process.env.E2E_EXPECTED_SHA!,
			convexUrl: process.env.PUBLIC_CONVEX_URL!,
			convexSiteUrl: process.env.PUBLIC_CONVEX_SITE_URL!
		});
	} else if (mode === 'reconcile') {
		const directory = process.argv[3];
		const files = readdirSync(directory, { recursive: true }).map(String);
		const load = (file: string) =>
			JSON.parse(readFileSync(join(directory, file), 'utf8')) as Report;
		const inventories = files.filter((file) => file.endsWith('inventory.json'));
		if (inventories.length !== 1) throw new Error('Expected exactly one full-suite inventory');
		console.log(
			JSON.stringify(
				reconcile(
					load(inventories[0]),
					files.filter((file) => file.endsWith('results.json')).map(load)
				)
			)
		);
	} else throw new Error('Expected prepare, check or reconcile');
}
