import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	currentPullRequestUrl,
	evaluatePullRequestMetadata,
	fetchCurrentPullRequest,
	parsePullRequestDocument,
	parsePullRequestEvent,
	readCurrentPullRequest,
	readPullRequestEvent,
	runPrMetadataCli,
	type MetadataCliOptions,
	type PullRequestFetch
} from './pr-metadata';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/english-policy/pr-metadata.ts');
const REPOSITORY = 'example/project';
const API_URL = 'https://api.github.com';
const fixtures: string[] = [];
const foreignFixtures = {
	german: 'Das Passwort muss sofort zurückgesetzt werden.',
	french: 'Ceci est un texte français clairement rédigé.'
} as const;
const renovateReleaseNotes = [
	[
		'### [`v4.0.15`](https://redirect.github.com/vitest-dev/vitest/releases/tag/v4.0.15)',
		'',
		'[Compare Source](https://redirect.github.com/vitest-dev/vitest/compare/v4.0.14...v4.0.15)',
		'',
		'##### Bug Fixes',
		'',
		'- preserve the invalid format diagnostic ([#8463](https://redirect.github.com/vitest-dev/vitest/pull/8463)) [<samp>view source</samp>]'
	].join('\n'),
	[
		'### [`v3.2.4`](https://redirect.github.com/vitest-dev/vitest/releases/tag/v3.2.4)',
		'',
		'##### Performance Improvements',
		'',
		'- avoid duplicate source-map work in browser mode ([#8120](https://github.com/vitest-dev/vitest/pull/8120))',
		'- update coverage output for Node.js 24.1.0'
	].join('\n')
] as const;

function fixture(value: unknown): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'pr-metadata-'));
	fixtures.push(directory);
	const file = path.join(directory, 'event.json');
	writeFileSync(file, JSON.stringify(value));
	return file;
}

function trigger(number: number, title = 'Stale event title', body: string | null = null) {
	return { action: 'edited', number, pull_request: { number, title, body } };
}

function response(
	requestUrl: string,
	value: unknown,
	init: ResponseInit = { status: 200 }
): Response {
	const headers = new Headers(init.headers);
	if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
	const result = new Response(JSON.stringify(value), { ...init, headers });
	Object.defineProperty(result, 'url', { value: requestUrl });
	return result;
}

function currentDocument(number: number, title: string, body: string | null) {
	return {
		number,
		title,
		body,
		base: { repo: { full_name: REPOSITORY } }
	};
}

function run(eventPath: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
	return spawnSync('bun', [SCRIPT, ...args], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, ...env, GITHUB_EVENT_PATH: eventPath, NO_COLOR: '1' }
	});
}

async function captureCli(
	options: MetadataCliOptions
): Promise<{ status: number; output: string }> {
	const output: string[] = [];
	vi.spyOn(console, 'log').mockImplementation((...values) => output.push(values.join(' ')));
	vi.spyOn(console, 'error').mockImplementation((...values) => output.push(values.join(' ')));
	return { status: await runPrMetadataCli(options), output: output.join('\n') };
}

afterEach(() => {
	for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe('pull request metadata policy', () => {
	it.each([
		'fix(auth): Passwort zurücksetzen',
		'fix: Fehler beheben',
		'docs: Anleitung schreiben',
		'docs: API aktualisieren',
		'test: Daten laden',
		'feat: Benutzer anmelden',
		'fix(auth): PASSWORT ZURUECKSETZEN',
		'fix: PASSWORT1 ZURUECKSETZEN1',
		'fix: PASSWORT_1 ZURUECKSETZEN_1'
	])('checks a clear non-English title independently: %s', (title) => {
		const result = evaluatePullRequestMetadata({
			pull_request: {
				title,
				body: 'This body explains the account recovery correction in English.'
			}
		});
		expect(result.findings).toMatchObject([{ field: 'title', language: 'de' }]);
	});

	it.each([
		'Fix API',
		'Update API',
		'docs: API documentation',
		'Cache JWKS',
		'fix(auth): Reset password',
		'Update docs',
		'Ship change',
		'fix: invalid format'
	])('passes a short English title conservatively: %s', (title) => {
		expect(evaluatePullRequestMetadata({ pull_request: { title, body: null } }).findings).toEqual(
			[]
		);
	});

	it.each([
		[foreignFixtures.german, 'de'],
		['API aktualisieren', 'de'],
		['PASSWORT1 ZURUECKSETZEN1', 'de'],
		['PASSWORT_1 ZURUECKSETZEN_1', 'de'],
		[foreignFixtures.french, 'fr'],
		['ESTE TEXTO ESTA CLARAMENTE ESCRITO EN ESPANOL', 'es']
	])('checks non-English body paragraphs independently: %s', (body, language) => {
		const result = evaluatePullRequestMetadata({
			pull_request: {
				title: 'fix(auth): Reset password',
				body: `This paragraph is English.\n\n${body}`
			}
		});
		expect(result.findings).toMatchObject([{ field: 'body', paragraph: 2, language }]);
	});

	it.each(renovateReleaseNotes)('passes embedded Renovate release-note Markdown', (body) => {
		expect(
			evaluatePullRequestMetadata({
				pull_request: { title: 'chore(deps): Update Vitest', body }
			}).findings
		).toEqual([]);
	});

	it('ignores fenced code even when it contains blank lines', () => {
		const result = evaluatePullRequestMetadata({
			pull_request: {
				title: 'Fix API',
				body: `This paragraph explains the change.\n\n\`\`\`text\n${foreignFixtures.german}\n\n${foreignFixtures.french}\n\`\`\``
			}
		});
		expect(result.findings).toEqual([]);
	});

	it.each([
		['backtick', '````', '```'],
		['tilde', '~~~~', '~~~']
	])('does not close a %s fence with a shorter nested marker', (_label, outer, inner) => {
		const body = [
			'This paragraph explains the example.',
			'',
			`${outer}markdown`,
			inner,
			foreignFixtures.german,
			inner,
			outer
		].join('\n');
		expect(
			evaluatePullRequestMetadata({ pull_request: { title: 'Fix API', body } }).findings
		).toEqual([]);
	});

	it('allows a null body', () => {
		expect(
			evaluatePullRequestMetadata({
				pull_request: { title: 'Fix API', body: null }
			}).findings
		).toEqual([]);
	});

	it('validates fetched metadata and edited event shapes independently', () => {
		expect(parsePullRequestDocument({ pull_request: { title: 'Fix API', body: null } })).toEqual({
			pull_request: { title: 'Fix API', body: null }
		});
		expect(parsePullRequestEvent(trigger(42))).toEqual({ action: 'edited', number: 42 });
		expect(() => parsePullRequestDocument({ pull_request: { title: 42, body: null } })).toThrow();
		expect(() => parsePullRequestEvent({ ...trigger(42), number: 41 })).toThrow();
		expect(() => parsePullRequestEvent({ ...trigger(42), action: 'closed' })).toThrow();
		expect(() => readPullRequestEvent(undefined)).toThrow();
	});

	it.each([
		['http://api.github.com', REPOSITORY, 1],
		['https://example.com', REPOSITORY, 1],
		['https://user@api.github.com', REPOSITORY, 1],
		['https://api.github.com?query=1', REPOSITORY, 1],
		[API_URL, 'example/project/extra', 1],
		[API_URL, '../project', 1],
		[API_URL, REPOSITORY, 0],
		[API_URL, REPOSITORY, Number.NaN]
	])('rejects a hostile current-document location: %s %s %s', (apiUrl, repository, number) => {
		expect(() => currentPullRequestUrl(apiUrl, repository, number)).toThrow();
	});

	it('classifies the trusted current-document file instead of the event snapshot', () => {
		const number = 41;
		const eventPath = fixture(trigger(number, foreignFixtures.german, foreignFixtures.french));
		const prJsonPath = fixture(
			currentDocument(number, 'fix(auth): Reset password', 'This body is current and English.')
		);
		const result = run(eventPath, ['--pr-json', prJsonPath], {
			GITHUB_REPOSITORY: REPOSITORY
		});
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status, output).toBe(0);
		expect(output).toContain('English policy passed');
		expect(output).not.toContain(foreignFixtures.german);
		expect(output).not.toContain(foreignFixtures.french);
	});

	it('reports trusted current-document findings without printing raw metadata', () => {
		const number = 42;
		const eventPath = fixture(trigger(number));
		const prJsonPath = fixture(
			currentDocument(number, 'docs: API aktualisieren', foreignFixtures.german)
		);
		const result = run(eventPath, ['--pr-json', prJsonPath], {
			GITHUB_REPOSITORY: REPOSITORY
		});
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status).toBe(1);
		expect(output).toContain('PR title: clear non-English prose');
		expect(output).toContain('PR body paragraph 1: clear non-English prose');
		expect(output).not.toContain('aktualisieren');
		expect(output).not.toContain(foreignFixtures.german);
	});

	it('classifies the fetched document instead of the edited event snapshot', async () => {
		const number = 42;
		const eventPath = fixture(trigger(number, foreignFixtures.german, foreignFixtures.french));
		const requestUrl = currentPullRequestUrl(API_URL, REPOSITORY, number);
		const fetcher = vi.fn<PullRequestFetch>(async (input, init) => {
			expect(input).toBe(requestUrl);
			expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
			expect(Object.keys(init.headers as Record<string, string>)).not.toContain('Authorization');
			return response(
				requestUrl,
				currentDocument(number, 'fix(auth): Reset password', 'This body is current and English.')
			);
		});
		const result = await captureCli({
			eventPath,
			repository: REPOSITORY,
			apiUrl: API_URL,
			fetcher
		});
		expect(result.status).toBe(0);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(result.output).toContain('English policy passed');
		expect(result.output).not.toContain(foreignFixtures.german);
		expect(result.output).not.toContain(foreignFixtures.french);
	});

	it('fails closed on current fetched metadata without printing it', async () => {
		const number = 43;
		const eventPath = fixture(trigger(number, 'Fix API'));
		const requestUrl = currentPullRequestUrl(API_URL, REPOSITORY, number);
		const fetcher: PullRequestFetch = async () =>
			response(requestUrl, currentDocument(number, 'docs: API aktualisieren', 'API aktualisieren'));
		const result = await captureCli({
			eventPath,
			repository: REPOSITORY,
			apiUrl: API_URL,
			fetcher
		});
		expect(result.status).toBe(1);
		expect(result.output).toContain('PR title: clear non-English prose');
		expect(result.output).toContain('PR body paragraph 1: clear non-English prose');
		expect(result.output).not.toContain('aktualisieren');
	});

	it.each([
		['rate limit', 44, (url: string) => response(url, {}, { status: 403 })],
		[
			'wrong pull request',
			45,
			(url: string) => response(url, currentDocument(46, 'Fix API', null))
		],
		[
			'wrong repository',
			47,
			(url: string) =>
				response(url, {
					...currentDocument(47, 'Fix API', null),
					base: { repo: { full_name: 'other/project' } }
				})
		],
		[
			'oversized response',
			48,
			(url: string) =>
				response(url, currentDocument(48, 'Fix API', null), {
					status: 200,
					headers: { 'content-length': String(2 * 1024 * 1024 + 1) }
				})
		]
	] as const)('fails closed on a %s response', async (_label, number, makeResponse) => {
		const requestUrl = currentPullRequestUrl(API_URL, REPOSITORY, number);
		await expect(
			fetchCurrentPullRequest(API_URL, REPOSITORY, number, async () => makeResponse(requestUrl))
		).rejects.toThrow();

		const result = await captureCli({
			eventPath: fixture(trigger(number)),
			repository: REPOSITORY,
			apiUrl: API_URL,
			fetcher: async () => makeResponse(requestUrl)
		});
		expect(result.status).toBe(1);
		expect(result.output).toBe(
			'English policy failed: current pull request metadata could not be read or validated.'
		);
	});

	it('bounds and identity-checks the trusted current-document file', () => {
		const number = 49;
		expect(
			readCurrentPullRequest(fixture(currentDocument(number, 'Fix API', null)), number, REPOSITORY)
		).toEqual({ pull_request: { title: 'Fix API', body: null } });
		expect(() =>
			readCurrentPullRequest(
				fixture(currentDocument(number + 1, 'Fix API', null)),
				number,
				REPOSITORY
			)
		).toThrow('does not match');
		expect(() =>
			readCurrentPullRequest(
				fixture({
					...currentDocument(number, 'Fix API', null),
					base: { repo: { full_name: 'other/project' } }
				}),
				number,
				REPOSITORY
			)
		).toThrow('does not match');
		expect(() =>
			readCurrentPullRequest(
				fixture({ ...currentDocument(number, 'Fix API', null), body: 42 }),
				number,
				REPOSITORY
			)
		).toThrow('body is invalid');
		const malformedUtf8 = fixture(currentDocument(number, 'X', null));
		const malformedBytes = Buffer.from(JSON.stringify(currentDocument(number, 'X', null)));
		const titleOffset = malformedBytes.indexOf(0x58);
		expect(titleOffset).toBeGreaterThan(-1);
		malformedBytes[titleOffset] = 0xff;
		writeFileSync(malformedUtf8, malformedBytes);
		expect(() => readCurrentPullRequest(malformedUtf8, number, REPOSITORY)).toThrow();
		expect(() =>
			readCurrentPullRequest(fixture('x'.repeat(2 * 1024 * 1024 + 1)), number, REPOSITORY)
		).toThrow('exceeds the inspection limit');
	});

	it('fails closed on malformed event JSON', () => {
		const event = fixture(trigger(49));
		writeFileSync(event, '{');
		const result = run(event);
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain('could not be read or validated');
	});

	it('treats hostile fetched metadata as data and does not echo it', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'pr-metadata-hostile-'));
		fixtures.push(directory);
		const marker = path.join(directory, 'owned');
		const payload = `$(touch ${marker})`;
		const number = 50;
		const eventPath = fixture(trigger(number));
		const requestUrl = currentPullRequestUrl(API_URL, REPOSITORY, number);
		const fetcher: PullRequestFetch = async () =>
			response(requestUrl, currentDocument(number, 'Fix API', payload));
		const result = await captureCli({
			eventPath,
			repository: REPOSITORY,
			apiUrl: API_URL,
			fetcher
		});
		expect(result.status).toBe(0);
		expect(existsSync(marker)).toBe(false);
		expect(result.output).not.toContain(payload);
		expect(result.output).not.toContain(marker);
	});
});
