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
	it('checks the title independently from an English body', () => {
		const result = evaluatePullRequestMetadata({
			pull_request: {
				title: 'fix(auth): Passwort zurücksetzen',
				body: 'This body explains the account recovery correction in English.'
			}
		});
		expect(result.findings).toMatchObject([{ field: 'title', language: 'de' }]);
	});

	it('checks body paragraphs independently from an English title', () => {
		const result = evaluatePullRequestMetadata({
			pull_request: {
				title: 'fix(auth): Reset password',
				body: `This paragraph is English.\n\n${foreignFixtures.french}`
			}
		});
		expect(result.findings).toMatchObject([{ field: 'body', paragraph: 2, language: 'fr' }]);
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
