// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
	assertBuildMetadata,
	assertMetadata,
	discoverPreview,
	fetchJson,
	latestCloudflarePreview,
	metadataCheckMode,
	resolveBuild,
	triggeringCheckId,
	verifiedCloudflarePreview,
	backendKey,
	cases,
	reconcile,
	shardCount,
	type PreviewCheck,
	type Report,
	type VerifiedBuild
} from './e2e-ci';
function report(ids: string[]): Report {
	return {
		suites: [
			{
				specs: ids.map((id) => ({
					id,
					tests: [
						{
							projectName: 'public',
							expectedStatus: 'passed',
							status: 'expected',
							results: [{ status: 'passed' }]
						}
					]
				}))
			}
		]
	};
}
describe('complete preview result aggregation', () => {
	it('requires each collected case exactly once, independently of lane count', () => {
		const inventory = report(['a', 'b', 'c']);
		expect(reconcile(inventory, [report(['a']), report(['b', 'c'])]).cases).toBe(3);
		expect(() => reconcile(inventory, [report(['a']), report(['b'])])).toThrow('Missing execution');
		expect(() => reconcile(inventory, [report(['a', 'b']), report(['b', 'c'])])).toThrow(
			'Duplicate execution'
		);
		expect(() => reconcile(inventory, [report([])])).toThrow('Empty E2E shard');
		const failed = report(['a', 'b', 'c']);
		cases(failed).values().next().value!.status = 'unexpected';
		expect(() => reconcile(inventory, [failed])).toThrow('did not pass');
	});
	it('rejects incomplete lifecycle evidence and unexecuted cases', () => {
		const failed = report(['a']);
		failed.errors = [{ message: 'cleanup failed' }];
		expect(() => reconcile(report(['a']), [failed])).toThrow('lifecycle');
		delete failed.errors;
		cases(failed).values().next().value!.results = [];
		expect(() => reconcile(report(['a']), [failed])).toThrow('did not pass');
	});
	it('fails on a moving frontend or mismatched backend', () => {
		const config = { convexUrl: 'https://a.convex.cloud', convexSiteUrl: 'https://a.convex.site' };
		const expected = { ...config, sha: 'abc' };
		expect(() => assertMetadata({ version: 'abc' }, config, expected)).not.toThrow();
		expect(() => assertMetadata({ version: 'old' }, config, expected)).toThrow('revision');
		expect(() =>
			assertMetadata(
				{ version: 'abc' },
				{ ...config, convexUrl: 'https://b.convex.cloud' },
				expected
			)
		).toThrow('discovery');
	});
	it('validates counts and keys the writer lock by canonical backend origin', () => {
		expect(shardCount(undefined)).toBe(1);
		expect(shardCount('3')).toBe(3);
		for (const bad of ['0', '-1', '1.5', '33', 'two']) expect(() => shardCount(bad)).toThrow();
		expect(backendKey('https://a.convex.cloud')).toBe(backendKey('https://a.convex.cloud/'));
		expect(backendKey('https://a.convex.cloud')).not.toBe(backendKey('https://b.convex.cloud'));
	});
});

const sha = 'a'.repeat(40);
const alias = 'https://branch-starter.example.workers.dev';
const uuid = (digit: string) =>
	`${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const current = uuid('c');
const old = uuid('b');
const backends = {
	convexUrl: 'https://current-lark.convex.cloud',
	convexSiteUrl: 'https://current-lark.convex.site'
};

// Summary lines follow the actual Workers Builds check-run output.
function check(overrides: Partial<PreviewCheck> & { build?: string; version?: string } = {}) {
	const { build = current, version = '7f285582', ...record } = overrides;
	return {
		id: 2,
		head_sha: sha,
		status: 'completed',
		conclusion: 'success',
		completed_at: '2026-10-02T14:56:23Z',
		app: { slug: 'cloudflare-workers-and-pages' },
		output: {
			summary: `\nBuild ID: [${build}](https://dash.cloudflare.com/account/workers/services/view/starter/production/builds/${build})\nScript: [starter](https://dash.cloudflare.com/account/workers/services/view/starter/production)\nVersion ID: ${version}-0000\nPreview URL: https://${version}-starter.example.workers.dev\nPreview Alias URL: ${alias}\n`
		},
		...record
	} satisfies PreviewCheck;
}

describe('Cloudflare build record selection', () => {
	it('binds origin and build UUID to one successful record of the exact commit', () => {
		expect(verifiedCloudflarePreview(check(), sha)).toEqual({
			checkId: 2,
			sha,
			origin: alias,
			buildUuid: current
		});
		expect(verifiedCloudflarePreview(check(), sha, `${alias}/`).origin).toBe(alias);
		for (const input of [
			'https://attacker.example.com',
			'http://branch-starter.example.workers.dev',
			'https://branch-starter.example.workers.dev@attacker.example.com',
			'https://branch-starter.example.workers.dev/?redirect=evil'
		])
			expect(() => verifiedCloudflarePreview(check(), sha, input)).toThrow();
		for (const record of [
			check({ app: { slug: 'github-actions' } }),
			check({ head_sha: 'b'.repeat(40) }),
			check({ conclusion: 'failure' }),
			check({ status: 'in_progress', conclusion: null })
		])
			expect(() => verifiedCloudflarePreview(record, sha)).toThrow('successful Cloudflare');
		for (const build of ['not-a-uuid', '', `${current}0`])
			expect(() => verifiedCloudflarePreview(check({ build }), sha)).toThrow('build UUID');
		const twice = check();
		twice.output.summary += `Build ID: [${old}](https://dash.cloudflare.com/x)\n`;
		expect(() => verifiedCloudflarePreview(twice, sha)).toThrow('build UUID');
	});

	it('selects the newest completed build for a manual origin regardless of record order', () => {
		const records = [
			check({ id: 1, build: old, completed_at: '2026-10-02T14:00:00Z' }),
			check({ id: 3, build: current, completed_at: '2026-10-02T15:00:00Z' }),
			check({
				id: 4,
				build: uuid('d'),
				conclusion: 'failure',
				completed_at: '2026-10-02T16:00:00Z'
			}),
			check({ id: 5, status: 'in_progress', conclusion: null, completed_at: null }),
			check({ id: 6, build: uuid('e'), head_sha: 'b'.repeat(40) })
		];
		for (const order of [records, [...records].reverse()])
			expect(latestCloudflarePreview(order, sha, alias)).toMatchObject({
				checkId: 3,
				buildUuid: current
			});
		const tied = [check({ id: 7, build: old }), check({ id: 8, build: current })];
		expect(latestCloudflarePreview(tied, sha, alias).buildUuid).toBe(current);
		expect(latestCloudflarePreview([...tied].reverse(), sha, alias).buildUuid).toBe(current);
	});

	it('never borrows a build identity from a record that did not publish the origin', () => {
		const otherAlias = check({ id: 9, build: current, completed_at: '2026-10-02T15:00:00Z' });
		otherAlias.output.summary = otherAlias.output.summary!.replace(
			alias,
			'https://other.example.workers.dev'
		);
		const older = check({ id: 1, build: old, completed_at: '2026-10-02T14:00:00Z' });
		expect(latestCloudflarePreview([otherAlias, older], sha, alias)).toMatchObject({
			checkId: 1,
			buildUuid: old
		});
		const newestMalformed = check({
			id: 10,
			build: 'broken',
			completed_at: '2026-10-02T16:00:00Z'
		});
		expect(() => latestCloudflarePreview([older, newestMalformed], sha, alias)).toThrow(
			'build UUID'
		);
	});
});

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
const servers: Array<{ close(): void; closeAllConnections(): void }> = [];
afterEach(() => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		server.close();
	}
});
async function serve(handler: Handler): Promise<{ origin: string; paths: string[] }> {
	const paths: string[] = [];
	const server = createServer((request, response) => {
		paths.push(request.url!);
		handler(request, response);
	});
	servers.push(server);
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, paths };
}
function json(response: ServerResponse, body: unknown, status = 200) {
	response.writeHead(status, { 'content-type': 'application/json' });
	response.end(JSON.stringify(body));
}

describe('bounded metadata reads', () => {
	it('fails a response whose body stalls after the headers', async () => {
		const server = await serve((_, response) => {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.write('{"convexUrl":');
		});
		const started = Date.now();
		await expect(fetchJson(server.origin, {}, 200)).rejects.toThrow('timed out after 200ms');
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it('reports HTTP failures and malformed bodies distinctly', async () => {
		const server = await serve((request, response) =>
			request.url === '/missing' ? json(response, {}, 503) : response.end('<html>')
		);
		await expect(fetchJson(`${server.origin}/missing`, {}, 1_000)).rejects.toThrow('HTTP 503');
		await expect(fetchJson(server.origin, {}, 1_000)).rejects.toThrow('malformed JSON');
	});
});

describe('automatic and manual build lookup', () => {
	const github = (api: string) => ({ api, repository: 'owner/repo', token: 'token' });

	it('retrieves the triggering check by ID instead of searching a commit page', async () => {
		const newer = check({ id: 99, build: uuid('d'), completed_at: '2026-10-02T16:00:00Z' });
		const api = await serve((request, response) =>
			request.url === '/repos/owner/repo/check-runs/2'
				? json(response, check())
				: json(response, { total_count: 1, check_runs: [newer] })
		);
		await expect(resolveBuild({ sha, checkRunId: 2, github: github(api.origin) })).resolves.toEqual(
			{
				checkId: 2,
				sha,
				origin: alias,
				buildUuid: current
			}
		);
		expect(api.paths).toEqual(['/repos/owner/repo/check-runs/2']);
	});

	it('rejects a record that does not match the requested check or tested commit', async () => {
		const api = await serve((request, response) =>
			json(
				response,
				request.url!.endsWith('/7') ? check({ id: 8 }) : check({ head_sha: 'b'.repeat(40) })
			)
		);
		await expect(resolveBuild({ sha, checkRunId: 7, github: github(api.origin) })).rejects.toThrow(
			'different record'
		);
		await expect(resolveBuild({ sha, checkRunId: 2, github: github(api.origin) })).rejects.toThrow(
			'successful Cloudflare'
		);
	});

	it('pages through every check run for a manual dispatch', async () => {
		const filler = Array.from({ length: 100 }, (_, index) => ({
			...check({ id: 1_000 + index }),
			app: { slug: 'github-actions' }
		}));
		const api = await serve((request, response) => {
			const page = new URL(request.url!, 'http://api').searchParams.get('page');
			json(response, {
				total_count: 102,
				check_runs:
					page === '1'
						? filler
						: [check({ id: 2, build: old, completed_at: '2026-10-02T14:00:00Z' }), check({ id: 3 })]
			});
		});
		await expect(
			resolveBuild({ sha, previewUrl: alias, github: github(api.origin) })
		).resolves.toMatchObject({ checkId: 3, buildUuid: current });
		expect(api.paths).toHaveLength(2);
		for (const path of api.paths)
			expect(new URL(path, 'http://api').searchParams.get('filter')).toBe('all');
	});

	it('fails instead of selecting from a truncated collection', async () => {
		const api = await serve((request, response) => {
			const page = Number(new URL(request.url!, 'http://api').searchParams.get('page'));
			json(response, {
				total_count: 5_000,
				check_runs: Array.from({ length: 100 }, (_, index) => check({ id: page * 1_000 + index }))
			});
		});
		await expect(
			resolveBuild({ sha, previewUrl: alias, github: github(api.origin) })
		).rejects.toThrow('lookup incomplete: read 1000 of 5000');
		const short = await serve((_, response) =>
			json(response, { total_count: 3, check_runs: [check()] })
		);
		await expect(
			resolveBuild({ sha, previewUrl: alias, github: github(short.origin) })
		).rejects.toThrow('lookup incomplete');
	});

	it('takes the exact check ID from the explicit input or the legacy event payload', () => {
		const directory = mkdtempSync(join(tmpdir(), 'e2e-ci-event-'));
		try {
			const event = (body: unknown) => {
				const file = join(directory, `${Math.random()}.json`);
				writeFileSync(file, JSON.stringify(body));
				return file;
			};
			expect(triggeringCheckId({ E2E_CHECK_RUN_ID: '42' })).toBe(42);
			expect(
				triggeringCheckId({
					E2E_CHECK_RUN_ID: '',
					GITHUB_EVENT_PATH: event({ check_run: { id: 43 } })
				})
			).toBe(43);
			expect(triggeringCheckId({ GITHUB_EVENT_PATH: event({ inputs: { sha } }) })).toBeUndefined();
			expect(triggeringCheckId({})).toBeUndefined();
			for (const env of [
				{ E2E_CHECK_RUN_ID: 'abc' },
				{ E2E_CHECK_RUN_ID: '0' },
				{ GITHUB_EVENT_PATH: event({ check_run: { id: '1; rm' } }) },
				{ GITHUB_EVENT_PATH: event({ check_run: { id: null } }) }
			])
				expect(() => triggeringCheckId(env)).toThrow('numeric triggering check');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe('preview build discovery', () => {
	const build: VerifiedBuild = { checkId: 2, sha, origin: alias, buildUuid: current };
	const budget = { overallMs: 2_000, attemptMs: 300, retryDelayMs: 10 };
	/** Real HTTP against a local server standing in for the HTTPS alias. */
	async function servedAlias(responses: Handler[]) {
		let index = 0;
		const server = await serve((request, response) =>
			responses[Math.min(index++, responses.length - 1)](request, response)
		);
		const fetcher = ((url: string | URL, init?: RequestInit) =>
			fetch(String(url).replace(alias, server.origin), init)) as typeof fetch;
		return { server, fetch: fetcher };
	}
	const serving =
		(config: Record<string, unknown>): Handler =>
		(_, response) =>
			json(response, { ...backends, generatedAt: 'now', ...config });

	it('waits through an old commit until the selected build is served', async () => {
		const target = await servedAlias([
			serving({ sourceSha: 'b'.repeat(40), buildUuid: old }),
			serving({ sourceSha: sha, buildUuid: current })
		]);
		await expect(discoverPreview(build, { fetch: target.fetch, budget })).resolves.toEqual({
			...build,
			...backends
		});
		expect(target.server.paths).toEqual([
			'/.well-known/e2e-config.json',
			'/.well-known/e2e-config.json'
		]);
	});

	it('rejects the same commit built earlier until the selected build UUID arrives', async () => {
		const target = await servedAlias([
			serving({ sourceSha: sha, buildUuid: old }),
			serving({ sourceSha: sha, buildUuid: old }),
			serving({ sourceSha: sha, buildUuid: current })
		]);
		await expect(discoverPreview(build, { fetch: target.fetch, budget })).resolves.toMatchObject({
			buildUuid: current
		});
		expect(target.server.paths).toHaveLength(3);
	});

	it('retries failed, malformed and stalled responses within the overall budget', async () => {
		const target = await servedAlias([
			(_, response) => json(response, {}, 503),
			(_, response) => response.end('not json'),
			(_, response) => {
				response.writeHead(200);
				response.write('{');
			},
			serving({ sourceSha: sha, buildUuid: current })
		]);
		await expect(discoverPreview(build, { fetch: target.fetch, budget })).resolves.toMatchObject({
			buildUuid: current
		});
	});

	it('fails with the last observation once the budget is exhausted', async () => {
		const stale = await servedAlias([serving({ sourceSha: sha, buildUuid: old })]);
		const started = Date.now();
		// A retry delay beyond the budget makes the stale response the final observation.
		await expect(
			discoverPreview(build, {
				fetch: stale.fetch,
				budget: { overallMs: 300, attemptMs: 300, retryDelayMs: 1_000 }
			})
		).rejects.toThrow(`served source "${sha}", build "${old}"`);
		expect(Date.now() - started).toBeLessThan(1_500);
		const legacy = await servedAlias([serving({})]);
		await expect(
			discoverPreview(build, { fetch: legacy.fetch, budget: { ...budget, overallMs: 200 } })
		).rejects.toThrow('superseded');
		const stalled = await servedAlias([
			(_, response) => {
				response.writeHead(200);
				response.write('{');
			}
		]);
		await expect(
			discoverPreview(build, { fetch: stalled.fetch, budget: { ...budget, overallMs: 500 } })
		).rejects.toThrow('timed out');
	});

	it('rejects invalid backend origins of the selected build without retrying', async () => {
		const target = await servedAlias([
			serving({ sourceSha: sha, buildUuid: current, convexUrl: 'https://evil.example/path' })
		]);
		await expect(discoverPreview(build, { fetch: target.fetch, budget })).rejects.toThrow(
			'backend origin'
		);
		expect(target.server.paths).toHaveLength(1);
	});

	it('bypasses caches and forwards the preview access headers', async () => {
		const headers: Array<IncomingMessage['headers']> = [];
		const target = await servedAlias([
			(request, response) => {
				headers.push(request.headers);
				serving({ sourceSha: sha, buildUuid: current })(request, response);
			}
		]);
		await discoverPreview(build, {
			fetch: target.fetch,
			budget,
			headers: { 'CF-Access-Client-Id': 'client' }
		});
		expect(headers).toMatchObject([
			{ 'cache-control': 'no-cache', 'cf-access-client-id': 'client' }
		]);
	});
});

describe('preview metadata policies', () => {
	const version = { version: sha };
	const expected = { sha, buildUuid: current, ...backends };

	it('strictly requires the accepted Workers build', () => {
		expect(() =>
			assertBuildMetadata(version, { ...backends, sourceSha: sha, buildUuid: current }, expected)
		).not.toThrow();
		expect(() =>
			assertBuildMetadata(version, { ...backends, sourceSha: sha, buildUuid: old }, expected)
		).toThrow('Preview build changed');
		expect(() => assertBuildMetadata(version, backends, expected)).toThrow('Preview build changed');
		for (const buildUuid of ['', 'undefined'])
			expect(() =>
				assertBuildMetadata(
					version,
					{ ...backends, sourceSha: sha, buildUuid: current },
					{
						...expected,
						buildUuid
					}
				)
			).toThrow('requires the accepted source SHA and build UUID');
		expect(() =>
			assertBuildMetadata(
				version,
				{ ...backends, sourceSha: sha, buildUuid: current, convexUrl: 'https://b.convex.cloud' },
				expected
			)
		).toThrow('discovery');
	});

	it('keeps the generic check for configs without a build identity', () => {
		expect(() => assertMetadata(version, backends, expected)).not.toThrow();
	});

	it('maps only known action policies', () => {
		expect(metadataCheckMode(undefined)).toBe('check');
		expect(metadataCheckMode('')).toBe('check');
		expect(metadataCheckMode('generic')).toBe('check');
		expect(metadataCheckMode('cf-build')).toBe('check-cf-build');
		for (const policy of ['strict', 'CF-BUILD', 'check-cf-build'])
			expect(() => metadataCheckMode(policy)).toThrow('Unknown metadata policy');
	});
});

const root = resolve(import.meta.dirname, '..');
function runCli(args: string[], env: Record<string, string>) {
	const inherited = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR'];
	return new Promise<{ code: number | null; output: string }>((done) => {
		const child = spawn('bun', ['--no-env-file', 'scripts/e2e-ci.ts', ...args], {
			cwd: root,
			env: {
				...Object.fromEntries(
					inherited.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : []))
				),
				...env
			}
		});
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		child.stderr.on('data', (chunk) => (output += chunk));
		child.on('close', (code) => done({ code, output }));
	});
}

describe('workflow compatibility', () => {
	it('keeps the legacy resolve-target invocation working from the event payload', async () => {
		const api = await serve((request, response) =>
			request.url === '/repos/owner/repo/check-runs/2'
				? json(response, check())
				: json(response, { message: 'Not Found' }, 404)
		);
		const directory = mkdtempSync(join(tmpdir(), 'e2e-ci-legacy-'));
		try {
			const githubEnv = join(directory, 'env');
			const eventPath = join(directory, 'event.json');
			writeFileSync(githubEnv, '');
			writeFileSync(eventPath, JSON.stringify({ check_run: { id: 2, head_sha: sha } }));
			// Exactly the step environment of the pre-discovery workflow definition.
			const result = await runCli(['resolve-target'], {
				GH_TOKEN: 'token',
				E2E_EXPECTED_SHA: sha,
				PREVIEW_URL: '',
				SUMMARY: check().output.summary,
				GITHUB_EVENT_PATH: eventPath,
				GITHUB_API_URL: api.origin,
				GITHUB_REPOSITORY: 'owner/repo',
				GITHUB_ENV: githubEnv
			});
			expect(result.code, result.output).toBe(0);
			expect(readFileSync(githubEnv, 'utf8')).toBe(`PREVIEW_URL=${alias}\n`);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);

	it('exports nothing when discovery rejects the provider record', async () => {
		const api = await serve((_, response) => json(response, check({ build: 'malformed' })));
		const directory = mkdtempSync(join(tmpdir(), 'e2e-ci-discover-'));
		try {
			const githubEnv = join(directory, 'env');
			writeFileSync(githubEnv, '');
			const result = await runCli(['discover'], {
				GH_TOKEN: 'token',
				E2E_EXPECTED_SHA: sha,
				E2E_CHECK_RUN_ID: '2',
				PREVIEW_URL: '',
				GITHUB_API_URL: api.origin,
				GITHUB_REPOSITORY: 'owner/repo',
				GITHUB_ENV: githubEnv
			});
			expect(result.code).not.toBe(0);
			expect(result.output).toContain('build UUID');
			expect(readFileSync(githubEnv, 'utf8')).toBe('');
			expect(api.paths).toEqual(['/repos/owner/repo/check-runs/2']);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);

	/** Evaluates only the expressions this test supplies; any other expression fails the test. */
	function evaluate(value: unknown, context: Record<string, string>): string {
		return String(value ?? '').replace(/\$\{\{(.*?)\}\}/g, (_, expression: string) => {
			const key = expression.trim();
			if (!(key in context)) throw new Error(`Unresolved workflow expression: ${key}`);
			return context[key];
		});
	}

	it('runs both CF lanes through the strict build check before and after execution', async () => {
		type Step = {
			uses?: string;
			run?: string;
			with?: Record<string, unknown>;
			env?: Record<string, unknown>;
		};
		type Job = { env: Record<string, unknown>; steps: Step[]; outputs?: Record<string, unknown> };
		const workflow = parseYaml(
			readFileSync(join(root, '.github/workflows/e2e-preview-cf.yml'), 'utf8')
		) as { jobs: Record<string, Job> };
		const action = parseYaml(
			readFileSync(join(root, '.github/actions/e2e-run/action.yml'), 'utf8')
		) as {
			inputs: Record<string, { default?: string }>;
			runs: { steps: Step[] };
		};
		let served: Record<string, unknown> = {};
		const site = await serve((request, response) =>
			json(response, request.url === '/_app/version.json' ? { version: sha } : served)
		);
		const prepared: Record<string, string> = {
			url: site.origin,
			'convex-url': backends.convexUrl,
			'convex-site-url': backends.convexSiteUrl,
			'build-uuid': current,
			count: '2',
			matrix: '{"shard":[1,2]}',
			'backend-key': 'key'
		};
		const outputs = Object.keys(workflow.jobs.prepare.outputs ?? {});
		const context: Record<string, string> = {
			'github.event.check_run.head_sha || inputs.sha': sha,
			"needs.prepare.outputs.count == '1' && 'full' || 'exclusive'": 'exclusive',
			'matrix.shard': '1',
			'secrets.AUTH_E2E_TEST_SECRET': '',
			'secrets.CF_ACCESS_CLIENT_ID': '',
			'secrets.CF_ACCESS_CLIENT_SECRET': '',
			...Object.fromEntries(
				outputs.map((name) => [`needs.prepare.outputs.${name}`, prepared[name] ?? ''])
			)
		};
		const checks = ['exclusive', 'public'].flatMap((lane) => {
			const job = workflow.jobs[lane];
			const step = job.steps.find((candidate) => candidate.uses === './.github/actions/e2e-run')!;
			const inputs = Object.fromEntries(
				Object.entries(action.inputs).map(([name, input]) => [
					`inputs.${name}`,
					name in (step.with ?? {}) ? evaluate(step.with![name], context) : (input.default ?? '')
				])
			);
			const jobEnv = Object.fromEntries(
				Object.entries(job.env).map(([name, value]) => [name, evaluate(value, context)])
			);
			return action.runs.steps
				.filter((candidate) => candidate.run?.startsWith('bun scripts/e2e-ci.ts '))
				.map((candidate) => ({
					lane,
					args: candidate.run!.trim().split(/\s+/).slice(2),
					env: {
						...jobEnv,
						...Object.fromEntries(
							Object.entries(candidate.env ?? {}).map(([name, value]) => [
								name,
								evaluate(value, inputs)
							])
						)
					}
				}));
		});
		expect(checks.map((entry) => entry.lane)).toEqual([
			'exclusive',
			'exclusive',
			'public',
			'public'
		]);
		const runAll = () => Promise.all(checks.map((entry) => runCli(entry.args, entry.env)));

		served = { ...backends, sourceSha: sha, buildUuid: current };
		for (const result of await runAll()) expect(result.code, result.output).toBe(0);
		// Same commit, same backends, but the alias now serves another build.
		served = { ...backends, sourceSha: sha, buildUuid: old };
		for (const result of await runAll()) {
			expect(result.code).not.toBe(0);
			expect(result.output).toContain('Preview build changed');
		}
	}, 30_000);
});
