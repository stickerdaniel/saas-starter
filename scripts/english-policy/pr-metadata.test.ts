import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	evaluatePullRequestMetadata,
	parsePullRequestEvent,
	readPullRequestEvent
} from './pr-metadata';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/english-policy/pr-metadata.ts');
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

function run(eventPath: string) {
	return spawnSync('bun', [SCRIPT], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, GITHUB_EVENT_PATH: eventPath, NO_COLOR: '1' }
	});
}

afterEach(() => {
	for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('pull request metadata policy', () => {
	it.each([
		'fix(auth): Passwort zurücksetzen',
		'fix: Fehler beheben',
		'docs: Anleitung schreiben',
		'test: Daten laden',
		'feat: Benutzer anmelden',
		'fix(auth): PASSWORT ZURUECKSETZEN'
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

	it('validates the event shape', () => {
		expect(() => parsePullRequestEvent({ pull_request: { title: 42, body: null } })).toThrow();
		expect(() => parsePullRequestEvent({ issue: {} })).toThrow();
		expect(() => readPullRequestEvent(undefined)).toThrow();
	});

	it('fails closed on malformed event JSON', () => {
		const event = fixture({ pull_request: { title: 'Fix API', body: null } });
		writeFileSync(event, '{');
		const result = run(event);
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).toContain('could not be read or validated');
	});

	it('treats shell-looking metadata as data and does not echo it', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'pr-metadata-hostile-'));
		fixtures.push(directory);
		const marker = path.join(directory, 'owned');
		const payload = `$(touch ${marker})`;
		const event = fixture({ pull_request: { title: 'Fix API', body: payload } });
		const result = run(event);
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status).toBe(0);
		expect(existsSync(marker)).toBe(false);
		expect(output).not.toContain(payload);
		expect(output).not.toContain(marker);
	});

	it('reports bounded findings without echoing raw metadata', () => {
		const event = fixture({
			pull_request: { title: foreignFixtures.german, body: foreignFixtures.french }
		});
		const result = run(event);
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status).toBe(1);
		expect(output).toContain('PR title: clear non-English prose');
		expect(output).toContain('PR body paragraph 1: clear non-English prose');
		expect(output).not.toContain(foreignFixtures.german);
		expect(output).not.toContain(foreignFixtures.french);
		expect(output.length).toBeLessThan(1_000);
	});
});
