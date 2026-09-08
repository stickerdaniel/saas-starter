import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
	ALLOWED_TYPES,
	FINAL_PERIOD,
	INVALID_PR_DATA,
	INVALID_SCOPE,
	INVALID_SHAPE,
	INVALID_SUBJECT,
	MISSING_TITLE,
	UNSAFE_CHARACTER,
	UNSUPPORTED_TYPE,
	validateTitle
} from './check-pr-title';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-pr-title.ts');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github/workflows/check-pr-title.yml');

function runCli(title?: string, prJson?: string) {
	const env = { ...process.env };
	if (title === undefined) delete env.PR_TITLE;
	else env.PR_TITLE = title;
	const args = [SCRIPT];
	if (prJson !== undefined) args.push('--pr-json', prJson);
	return spawnSync('bun', args, { cwd: REPO_ROOT, env, encoding: 'utf-8' });
}

function withTempDirectory(run: (directory: string) => void): void {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-title-'));
	try {
		run(directory);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

describe('validateTitle', () => {
	it.each([
		'feat: Add title validation',
		'fix(parser): Reject an invalid title',
		'docs!: Rewrite the guide',
		'refactor(release workflow)!: Restore required checks'
	])('accepts the supported shape: %s', (title) => {
		expect(validateTitle(title)).toBeUndefined();
	});

	it('exposes exactly the repository-supported types', () => {
		expect(ALLOWED_TYPES).toEqual([
			'feat',
			'fix',
			'docs',
			'style',
			'refactor',
			'test',
			'chore',
			'perf',
			'ci'
		]);
	});

	it.each(ALLOWED_TYPES)('accepts the allowed type %s', (type) => {
		expect(validateTitle(`${type}: Accept this title`)).toBeUndefined();
	});

	it('accepts Renovate-compatible lowercase subjects', () => {
		expect(validateTitle('chore(deps): update dependency svelte to v5.57.0')).toBeUndefined();
	});

	it('rejects unsupported types without treating them as malformed', () => {
		expect(validateTitle('build: Package the release')).toBe(UNSUPPORTED_TYPE);
	});

	it.each([
		['fix:Add spacing', INVALID_SHAPE],
		['fix : Add spacing', INVALID_SHAPE],
		[' fix: Add spacing', INVALID_SHAPE],
		['fix(scope) : Add spacing', INVALID_SHAPE],
		['fix(scope)! : Add spacing', INVALID_SHAPE],
		['fix(scope)!!: Add spacing', INVALID_SHAPE],
		['fix!!: Add spacing', INVALID_SHAPE],
		['fix!extra: Add spacing', INVALID_SHAPE],
		['fix(): Add spacing', INVALID_SCOPE],
		['fix: ', INVALID_SUBJECT],
		['fix:  ', INVALID_SUBJECT],
		['fix:  Add spacing', INVALID_SUBJECT],
		['fix: Add spacing ', INVALID_SUBJECT],
		['fix: Add spacing.', FINAL_PERIOD]
	] as const)('returns a fixed diagnostic for %s', (title, diagnostic) => {
		expect(validateTitle(title)).toBe(diagnostic);
	});

	it.each([0x20, 0x00a0, 0x1680, 0x2000, 0x202f, 0x205f, 0x3000])(
		'rejects separator boundaries at code point %s',
		(codepoint) => {
			const separator = String.fromCodePoint(codepoint);
			expect(validateTitle(`fix(${separator}scope): Keep boundaries`)).toBe(INVALID_SCOPE);
			expect(validateTitle(`fix(scope${separator}): Keep boundaries`)).toBe(INVALID_SCOPE);
			expect(validateTitle(`fix: ${separator}Keep boundaries`)).toBe(INVALID_SUBJECT);
			expect(validateTitle(`fix: Keep boundaries${separator}`)).toBe(INVALID_SUBJECT);
		}
	);

	it.each([0x00ad, 0x180e, 0x200d])(
		'rejects format characters at boundaries at code point %s',
		(codepoint) => {
			const character = String.fromCodePoint(codepoint);
			expect(validateTitle(`fix(${character}scope): Keep boundaries`)).toBe(INVALID_SCOPE);
			expect(validateTitle(`fix(scope${character}): Keep boundaries`)).toBe(INVALID_SCOPE);
			expect(validateTitle(`fix: ${character}Keep boundaries`)).toBe(INVALID_SUBJECT);
			expect(validateTitle(`fix: Keep boundaries${character}`)).toBe(INVALID_SUBJECT);
		}
	);

	it.each([
		...Array.from({ length: 0x20 }, (_, codepoint) => codepoint),
		...Array.from({ length: 0x21 }, (_, index) => 0x7f + index),
		0x061c,
		0x200b,
		0x200e,
		0x200f,
		...Array.from({ length: 7 }, (_, index) => 0x2028 + index),
		0x2060,
		...Array.from({ length: 4 }, (_, index) => 0x2066 + index),
		0xfeff,
		0xfffd
	])('rejects unsafe code point U+%s anywhere', (codepoint) => {
		const character = String.fromCodePoint(codepoint);
		expect(validateTitle(`fix: Before${character}after`)).toBe(UNSAFE_CHARACTER);
	});

	it('requires substantive scope and subject content', () => {
		const combiningAcute = String.fromCodePoint(0x0301);
		expect(validateTitle(`fix(${combiningAcute}): Subject`)).toBe(INVALID_SCOPE);
		expect(validateTitle(`fix: ${combiningAcute}`)).toBe(INVALID_SUBJECT);
	});

	it.each([0x00ad, 0x0301])(
		'finds a final ASCII period before non-substantive code point %s',
		(codepoint) => {
			expect(validateTitle(`fix: Do not hide.${String.fromCodePoint(codepoint)}`)).toBe(
				FINAL_PERIOD
			);
		}
	);

	it('preserves decomposed accents', () => {
		const combiningAcute = String.fromCodePoint(0x0301);
		expect(
			validateTitle(`fix(cafe${combiningAcute}): Handle resume${combiningAcute}`)
		).toBeUndefined();
	});

	it('preserves internal emoji ZWJ sequences', () => {
		const zwj = String.fromCodePoint(0x200d);
		expect(validateTitle(`fix: Support 👩${zwj}💻 profiles`)).toBeUndefined();
	});

	it.each([
		'feat(HTTP/API v2): Preserve internal punctuation',
		'fix: Handle déjà vu safely',
		'docs: Explain 日本語 titles',
		'test: Permit commas, semicolons; and question marks?',
		'chore: Permit a Unicode full stop。',
		'perf(scope! #42): Permit punctuation in scope'
	])('accepts safe Unicode and punctuation: %s', (title) => {
		expect(validateTitle(title)).toBeUndefined();
	});
});

describe('title validator CLI', () => {
	it.each([
		'build: payload%0A::warning::leaked',
		'build: ::warning:: forged annotation',
		'fix: actual\rcontrol',
		'fix: actual\ncontrol',
		`fix: Invisible${String.fromCodePoint(0x200b)}content`
	])('emits one safe fixed annotation for invalid input', (title) => {
		const result = runCli(title);
		const output = result.stdout + result.stderr;

		expect(result.status).not.toBe(0);
		expect(output.split('\n').filter((line) => line.startsWith('::error::'))).toHaveLength(1);
		expect(output).toContain('Expected: type: subject');
		expect(output).not.toContain(title);
		expect(output).not.toContain('::warning::');
	});

	it('reports a missing environment title without outputting input', () => {
		const result = runCli();
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(`::error::${MISSING_TITLE}`);
	});

	it('exits silently for a valid environment title', () => {
		const result = runCli('fix(cli): Accept safe input');
		expect(result.status).toBe(0);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('');
	});

	it('reads the current title from PR JSON instead of the environment', () => {
		withTempDirectory((directory) => {
			const prJson = path.join(directory, 'pull-request.json');
			fs.writeFileSync(prJson, JSON.stringify({ title: 'fix(cli): Read current API data' }));
			const result = runCli('build: Ignore stale event data', prJson);
			expect(result.status).toBe(0);
			expect(result.stdout + result.stderr).toBe('');
		});
	});

	it.each(['{', '{}', '{"title":null}', '[]'])(
		'rejects malformed PR JSON safely: %s',
		(contents) => {
			withTempDirectory((directory) => {
				const prJson = path.join(directory, 'pull-request.json');
				fs.writeFileSync(prJson, contents);
				const result = runCli('fix: Stale event title', prJson);
				const output = result.stdout + result.stderr;
				expect(result.status).not.toBe(0);
				expect(
					output.split('\n').filter((line) => line === `::error::${INVALID_PR_DATA}`)
				).toHaveLength(1);
				expect(output).not.toContain(contents);
				expect(output).not.toContain('Stale event title');
			});
		}
	);

	it('rejects a missing PR JSON file without echoing its path', () => {
		withTempDirectory((directory) => {
			const prJson = path.join(directory, 'missing.json');
			const result = runCli('fix: Stale event title', prJson);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain(`::error::${INVALID_PR_DATA}`);
			expect(result.stdout + result.stderr).not.toContain(prJson);
		});
	});
});

describe('PR Title workflow', () => {
	const source = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
	const workflow = parseYaml(source) as {
		name: string;
		on: Record<string, { types: string[] }>;
		permissions: Record<string, string>;
		concurrency: { group: string; 'cancel-in-progress': boolean };
		jobs: Record<
			string,
			{
				name: string;
				steps: Array<{
					name?: string;
					uses?: string;
					with?: Record<string, unknown>;
					env?: Record<string, string>;
					run?: string;
				}>;
			}
		>;
	};
	const job = workflow.jobs.check!;

	it('uses the exact automatic trigger, permissions, concurrency, and check name', () => {
		expect(workflow.name).toBe('PR Title');
		expect(job.name).toBe('PR Title');
		expect(workflow.on).toEqual({
			pull_request_target: { types: ['opened', 'edited', 'reopened', 'synchronize'] }
		});
		expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
		expect(workflow.concurrency).toEqual({
			group: 'pr-title-${{ github.event.pull_request.number }}',
			'cancel-in-progress': true
		});
	});

	it('checks out and executes only the trusted workflow revision', () => {
		const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'))!;
		expect(checkout.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
		expect(checkout.with).toEqual({
			ref: '${{ github.workflow_sha }}',
			'persist-credentials': false
		});
		expect(
			job.steps.some((step) => /^oven-sh\/setup-bun@[0-9a-f]{40}$/.test(step.uses ?? ''))
		).toBe(true);
		expect(source).not.toMatch(/github\.event\.pull_request\.head|github\.head_ref|refs\/pull\//);
		expect(source).not.toMatch(/bun install|npm |pnpm |yarn /);
	});

	it('fetches current PR JSON with the token before running the dependency-free validator', () => {
		const fetch = job.steps.find((step) => step.name === 'Fetch current pull request')!;
		const validate = job.steps.find((step) => step.name === 'Validate current pull request title')!;
		expect(fetch.env).toEqual({
			GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
			PR_NUMBER: '${{ github.event.pull_request.number }}'
		});
		expect(fetch.run).toContain('gh api --method GET');
		expect(fetch.run).toContain('"repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}"');
		expect(fetch.run).toContain('> "$RUNNER_TEMP/pull-request.json"');
		expect(validate.run).toBe(
			'bun scripts/check-pr-title.ts --pr-json "$RUNNER_TEMP/pull-request.json"'
		);
		expect(validate.env).toBeUndefined();
		expect(source).not.toContain('github.event.pull_request.title');
	});

	it('has no comment or status fallback and documents SHA-like branch recovery', () => {
		expect(source).not.toMatch(/issue_comment|workflow_dispatch|statuses: write|\/statuses\//);
		expect(source).toContain('suppresses pull_request_target for SHA-like source branch names');
		expect(source).toContain('Renaming a head branch closes its pull request');
		expect(source).toContain('Open a replacement pull');
		expect(source).toContain('request from a non-SHA-like source branch');
	});
});
