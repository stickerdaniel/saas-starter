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
	// `new URL` silently drops tabs, newlines and edge whitespace; callers export the raw spelling.
	if (!url || /[\s\p{Cc}]/u.test(url)) throw new Error('Expected a backend origin');
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
const SHA = /^[a-f0-9]{40}$/;
const BUILD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOUDFLARE_APP = 'cloudflare-workers-and-pages';

export type PreviewCheck = {
	id: number;
	head_sha: string;
	status: string;
	conclusion: string | null;
	completed_at: string | null;
	app: { slug: string };
	output: { summary: string | null };
};
/** One provider record: its origin and build UUID are never taken from different checks. */
export type VerifiedBuild = { checkId: number; sha: string; origin: string; buildUuid: string };

function previewOrigin(input: string): string {
	const url = new URL(input);
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	)
		throw new Error('Expected an HTTPS preview origin');
	return url.origin;
}
function publishedOrigins(check: PreviewCheck, alias: boolean): string[] {
	const pattern = alias
		? /^Preview Alias URL: (https:\/\/\S+)$/gm
		: /^Preview(?: Alias)? URL: (https:\/\/\S+)$/gm;
	return [...(check.output?.summary || '').matchAll(pattern)].map(
		(match) => new URL(match[1]).origin
	);
}
/** API JSON is not typed at runtime; selection and identity rely on these fields. */
function checkId(check: PreviewCheck): number {
	const id: unknown = check?.id;
	if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
		throw new Error(
			`Expected a positive integer check ID, got ${JSON.stringify(id ?? null).slice(0, 40)}`
		);
	return id;
}
function completedAt(check: PreviewCheck): number {
	const value: unknown = check.completed_at;
	const time =
		typeof value === 'string' &&
		/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
			value
		)
			? Date.parse(value)
			: NaN;
	const date = typeof value === 'string' ? value.slice(0, 10) : '';
	if (Number.isNaN(time) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
		throw new Error(`Check ${check.id} has no valid completion time`);
	return time;
}
function isSuccessfulBuild(check: PreviewCheck, sha: string): boolean {
	return (
		check.head_sha === sha &&
		check.app?.slug === CLOUDFLARE_APP &&
		check.status === 'completed' &&
		check.conclusion === 'success'
	);
}

/**
 * Bind one successful Cloudflare check to the origin it published and the
 * build it names. Without a requested origin, the check's canonical alias is used.
 */
export function verifiedCloudflarePreview(
	check: PreviewCheck,
	sha: string,
	requested?: string
): VerifiedBuild {
	if (!SHA.test(sha)) throw new Error('Expected an exact source SHA');
	const origin = requested ? previewOrigin(requested) : undefined;
	const id = checkId(check);
	if (!isSuccessfulBuild(check, sha))
		throw new Error(
			`Check ${check.id} is not a successful Cloudflare build of the exact tested SHA`
		);
	const published = publishedOrigins(check, !origin);
	if (origin ? !published.includes(origin) : published.length !== 1)
		throw new Error(
			`Preview URL must come from a successful Cloudflare build of the exact tested SHA (check ${check.id})`
		);
	const ids = [
		...(check.output?.summary || '').matchAll(/^Build ID: \[([^\]\n]*)\]\(https:\/\/\S+\)$/gm)
	].map((match) => match[1]);
	if (ids.length !== 1 || !BUILD_UUID.test(ids[0]))
		throw new Error(`Check ${check.id} does not name exactly one Cloudflare build UUID`);
	return { checkId: id, sha, origin: origin ?? published[0], buildUuid: ids[0] };
}

/** Manual runs test the newest completed build that published the requested origin. */
export function latestCloudflarePreview(
	checks: PreviewCheck[],
	sha: string,
	requested: string
): VerifiedBuild {
	const origin = previewOrigin(requested);
	// Validate every candidate first, so a malformed newest record cannot be skipped.
	const [latest] = checks
		.filter(
			(check) => isSuccessfulBuild(check, sha) && publishedOrigins(check, false).includes(origin)
		)
		.map((check) => ({ check, id: checkId(check), time: completedAt(check) }))
		.sort((a, b) => b.time - a.time || b.id - a.id)
		.map(({ check }) => check);
	if (!latest)
		throw new Error(
			'Preview URL must come from a successful Cloudflare build of the exact tested SHA'
		);
	return verifiedCloudflarePreview(latest, sha, origin);
}

/** Read one JSON document; the deadline covers the headers and the complete body. */
export async function fetchJson(
	url: string | URL,
	init: RequestInit,
	timeoutMs: number,
	fetcher: typeof fetch = fetch
): Promise<unknown> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const error = new Error(`timed out after ${timeoutMs}ms`);
			controller.abort(error);
			reject(error);
		}, timeoutMs);
	});
	const read = async () => {
		const response = await fetcher(url, { ...init, signal: controller.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = await response.text();
		try {
			return JSON.parse(body) as unknown;
		} catch {
			throw new Error('malformed JSON');
		}
	};
	try {
		return await Promise.race([read(), deadline]);
	} finally {
		clearTimeout(timer);
	}
}

export type GithubApi = { api: string; repository: string; token: string };
type Lookup = { github: GithubApi; fetch?: typeof fetch; budgetMs?: number };
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function githubJson(lookup: Lookup, path: string, deadline: number): Promise<unknown> {
	const remaining = deadline - Date.now();
	if (remaining <= 0) throw new Error('Cloudflare build lookup exceeded its time budget');
	return fetchJson(
		`${lookup.github.api}/repos/${lookup.github.repository}/${path}`,
		{
			headers: {
				Authorization: `Bearer ${lookup.github.token}`,
				Accept: 'application/vnd.github+json'
			}
		},
		Math.min(20_000, remaining),
		lookup.fetch
	).catch((error: Error) => {
		throw new Error(`Cloudflare build lookup failed: ${error.message}`, { cause: error });
	});
}

/** The exact check that triggered an automatic run, or none for a manual dispatch. */
export function triggeringCheckId(env: Record<string, string | undefined>): number | undefined {
	let id: unknown = env.E2E_CHECK_RUN_ID || undefined;
	// Workflow definitions that predate E2E_CHECK_RUN_ID still run on check_run events.
	if (id === undefined && env.GITHUB_EVENT_PATH)
		id = (
			JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as { check_run?: { id?: unknown } }
		).check_run?.id;
	if (id === undefined) return undefined;
	if (!/^[1-9][0-9]*$/.test(String(id)) || !Number.isSafeInteger(Number(id)))
		throw new Error('Expected a numeric triggering check run ID');
	return Number(id);
}

/** Select the provider record under test, failing instead of guessing from partial evidence. */
export async function resolveBuild(
	options: Lookup & { sha: string; checkRunId?: number; previewUrl?: string }
): Promise<VerifiedBuild> {
	const { sha } = options;
	if (!SHA.test(sha)) throw new Error('Expected an exact source SHA');
	const deadline = Date.now() + (options.budgetMs ?? 60_000);
	if (options.checkRunId !== undefined) {
		const check = (await githubJson(
			options,
			`check-runs/${options.checkRunId}`,
			deadline
		)) as PreviewCheck;
		if (check?.id !== options.checkRunId)
			throw new Error(`GitHub returned a different record for check ${options.checkRunId}`);
		return verifiedCloudflarePreview(check, sha, options.previewUrl);
	}
	if (!options.previewUrl) throw new Error('No provider preview origin supplied');
	const checks = new Map<number, PreviewCheck>();
	let total = 0;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const body = (await githubJson(
			options,
			`commits/${sha}/check-runs?filter=all&per_page=${PAGE_SIZE}&page=${page}`,
			deadline
		)) as { total_count?: unknown; check_runs?: unknown };
		if (
			typeof body?.total_count !== 'number' ||
			!Number.isSafeInteger(body.total_count) ||
			body.total_count < 0 ||
			!Array.isArray(body.check_runs)
		)
			throw new Error('Cloudflare build lookup returned an unexpected check-run page');
		total = body.total_count;
		for (const check of body.check_runs as PreviewCheck[]) checks.set(checkId(check), check);
		if (checks.size > total)
			throw new Error(
				`Cloudflare build lookup inconsistent: read ${checks.size} check runs, reported total ${total}`
			);
		if (checks.size === total)
			return latestCloudflarePreview([...checks.values()], sha, options.previewUrl);
		if (body.check_runs.length < PAGE_SIZE) break;
	}
	throw new Error(
		`Cloudflare build lookup incomplete: read ${checks.size} of ${total} check runs within ${MAX_PAGES} pages; dispatch again or rerun the Cloudflare build`
	);
}

export type PreviewTarget = VerifiedBuild & { convexUrl: string; convexSiteUrl: string };
export type DiscoveryBudget = { overallMs: number; attemptMs: number; retryDelayMs: number };

/**
 * Wait until the alias serves the selected build's metadata. Nothing about the
 * target is trusted, probed or exported before source SHA, build UUID and both
 * backend origins have been accepted.
 */
export async function discoverPreview(
	build: VerifiedBuild,
	options: {
		headers?: Record<string, string>;
		fetch?: typeof fetch;
		budget?: DiscoveryBudget;
	} = {}
): Promise<PreviewTarget> {
	const budget = options.budget ?? { overallMs: 240_000, attemptMs: 20_000, retryDelayMs: 5_000 };
	const url = new URL('/.well-known/e2e-config.json', build.origin);
	const deadline = Date.now() + budget.overallMs;
	let attempts = 0;
	let last = 'no response';
	for (let remaining = budget.overallMs; remaining > 0; remaining = deadline - Date.now()) {
		attempts++;
		let config: unknown;
		try {
			config = await fetchJson(
				url,
				{
					headers: { ...options.headers, 'cache-control': 'no-cache', pragma: 'no-cache' },
					redirect: 'error'
				},
				Math.min(budget.attemptMs, remaining),
				options.fetch
			);
		} catch (error) {
			last = (error as Error).message;
		}
		if (config !== undefined) {
			const served = (config ?? {}) as Record<string, unknown>;
			if (served.sourceSha === build.sha && served.buildUuid === build.buildUuid) {
				const { convexUrl, convexSiteUrl } = served;
				if (typeof convexUrl !== 'string' || typeof convexSiteUrl !== 'string')
					throw new Error(`Build ${build.buildUuid} published no backend origins`);
				backendKey(convexUrl);
				backendKey(convexSiteUrl);
				return { ...build, convexUrl, convexSiteUrl };
			}
			const [source, uuid] = [served.sourceSha, served.buildUuid].map((value) =>
				JSON.stringify(value ?? null).slice(0, 80)
			);
			last = `served source ${source}, build ${uuid}`;
		}
		// A retry must wait its full delay and still start before the deadline.
		if (deadline - Date.now() <= budget.retryDelayMs) break;
		await new Promise((resolve) => setTimeout(resolve, budget.retryDelayMs));
	}
	throw new Error(
		`${build.origin} did not serve build ${build.buildUuid} of ${build.sha} within ${budget.overallMs / 1000}s ` +
			`(${attempts} attempts; last: ${last}). If a newer build replaced this alias, this run is superseded; ` +
			'otherwise rerun the Cloudflare Workers build for this commit.'
	);
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

/**
 * Strict Cloudflare check: the sampled alias must still serve the accepted
 * build. A missing expected identity fails rather than degrading to the generic check.
 */
export function assertBuildMetadata(
	version: unknown,
	config: unknown,
	expected: { sha: string; buildUuid: string; convexUrl: string; convexSiteUrl: string }
) {
	if (!SHA.test(expected.sha) || !BUILD_UUID.test(expected.buildUuid))
		throw new Error('Strict preview check requires the accepted source SHA and build UUID');
	assertMetadata(version, config, expected);
	const served = config as { sourceSha?: unknown; buildUuid?: unknown };
	if (served.sourceSha !== expected.sha || served.buildUuid !== expected.buildUuid)
		throw new Error(
			`Preview build changed: expected ${expected.buildUuid}, served ${JSON.stringify(served.buildUuid ?? null).slice(0, 80)}`
		);
}

/** Map the e2e-run action's metadata-policy input to its CLI check. */
export function metadataCheckMode(policy: string | undefined): 'check' | 'check-cf-build' {
	if (!policy || policy === 'generic') return 'check';
	if (policy === 'cf-build') return 'check-cf-build';
	throw new Error(`Unknown metadata policy: ${policy}`);
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
	const mode =
		process.argv[2] === 'check-policy'
			? metadataCheckMode(process.env.E2E_METADATA_POLICY)
			: process.argv[2];
	const selectBuild = () =>
		resolveBuild({
			sha: process.env.E2E_EXPECTED_SHA!,
			checkRunId: triggeringCheckId(process.env),
			previewUrl: process.env.PREVIEW_URL || undefined,
			github: {
				api: process.env.GITHUB_API_URL!,
				repository: process.env.GITHUB_REPOSITORY!,
				token: process.env.GH_TOKEN!
			}
		});
	const metadata = async () => {
		const headers = { ...getPreviewBypass().headers, 'cache-control': 'no-cache' };
		const get = async (path: string) => {
			try {
				return await fetchJson(
					new URL(path, process.env.PUBLIC_SITE_URL),
					{ headers, redirect: 'error' },
					20_000
				);
			} catch (error) {
				throw new Error(`Preview metadata ${(error as Error).message}: ${path}`, { cause: error });
			}
		};
		return [await get('/_app/version.json'), await get('/.well-known/e2e-config.json')] as const;
	};
	const expectedTarget = () => ({
		sha: process.env.E2E_EXPECTED_SHA!,
		convexUrl: process.env.PUBLIC_CONVEX_URL!,
		convexSiteUrl: process.env.PUBLIC_CONVEX_SITE_URL!
	});
	if (mode === 'resolve-target') {
		// Contract of workflow definitions that fetch the config themselves.
		const build = await selectBuild();
		console.log(`Legacy target resolution: Cloudflare check ${build.checkId} at ${build.origin}`);
		appendFileSync(process.env.GITHUB_ENV!, `PREVIEW_URL=${build.origin}\n`);
	} else if (mode === 'discover') {
		const build = await selectBuild();
		console.log(
			`Selected Cloudflare check ${build.checkId}: build ${build.buildUuid} of ${build.sha} at ${build.origin}`
		);
		const target = await discoverPreview(build, { headers: getPreviewBypass().headers });
		console.log(`Accepted backends ${target.convexUrl} and ${target.convexSiteUrl}`);
		appendFileSync(
			process.env.GITHUB_ENV!,
			`PUBLIC_SITE_URL=${target.origin}\nPUBLIC_CONVEX_URL=${target.convexUrl}\nPUBLIC_CONVEX_SITE_URL=${target.convexSiteUrl}\nE2E_BUILD_UUID=${target.buildUuid}\n`
		);
	} else if (mode === 'prepare') {
		const count = shardCount(process.env.E2E_PUBLIC_SHARDS);
		const matrix = {
			shard: count === 1 ? [1] : Array.from({ length: count }, (_, index) => index + 1)
		};
		appendFileSync(
			process.env.GITHUB_OUTPUT!,
			`matrix=${JSON.stringify(matrix)}\ncount=${count}\nbackend-key=${backendKey(process.env.PUBLIC_CONVEX_URL!)}\n`
		);
	} else if (mode === 'check') {
		assertMetadata(...(await metadata()), expectedTarget());
	} else if (mode === 'check-cf-build') {
		assertBuildMetadata(...(await metadata()), {
			...expectedTarget(),
			buildUuid: process.env.E2E_BUILD_UUID ?? ''
		});
		console.log(`Preview still serves build ${process.env.E2E_BUILD_UUID}`);
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
	} else
		throw new Error(
			'Expected resolve-target, discover, prepare, check, check-cf-build, check-policy or reconcile'
		);
}
