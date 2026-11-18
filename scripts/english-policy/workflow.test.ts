import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { testExecutable } from '../test-executable';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/require-english-pr.yml');
const BUNDLE_PATH = path.join(ROOT, 'scripts/english-policy/pr-metadata.bundle.mjs');
const ENTRY_PATH = path.join(ROOT, 'scripts/english-policy/pr-metadata.ts');
const source = readFileSync(WORKFLOW_PATH, 'utf8');

interface Step {
	name?: string;
	uses?: string;
	run?: string;
	env?: Record<string, string>;
	with?: Record<string, unknown>;
}

interface Workflow {
	on?: Record<string, { types?: string[] }>;
	permissions?: Record<string, string>;
	concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
	jobs?: Record<string, { steps?: Step[] }>;
}

const workflow = parseYaml(source) as Workflow;
const steps = workflow.jobs?.['english-metadata']?.steps ?? [];

/** Joins line continuations and collapses spacing so only the executed shell lines are compared. */
function shellLines(run: string): string[] {
	return run
		.replace(/\s*\\\n\s*/g, ' ')
		.split('\n')
		.map((line) => line.trim().replace(/\s+/g, ' '))
		.filter(Boolean);
}

describe('English pull request workflow', () => {
	it('uses the metadata-only trigger, minimal permissions, and one run per pull request', () => {
		expect(new Set(workflow.on?.pull_request_target?.types)).toEqual(
			new Set(['opened', 'edited', 'reopened', 'synchronize'])
		);
		expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
		expect(workflow.concurrency).toEqual({
			group: 'english-pr-${{ github.event.pull_request.number }}',
			'cancel-in-progress': true
		});
	});

	it('checks out only the trusted workflow revision without credentials', () => {
		const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
		expect(checkouts.length).toBeGreaterThan(0);
		for (const checkout of checkouts) {
			expect(checkout.with).toMatchObject({
				ref: '${{ github.workflow_sha }}',
				'persist-credentials': false
			});
		}
	});

	it('pins every action to a full commit SHA', () => {
		const actions = steps.filter((step) => step.uses).map((step) => step.uses!);
		expect(actions.length).toBeGreaterThan(0);
		for (const action of actions) expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
	});

	it('fetches private metadata with the ephemeral token and passes only its temp file', () => {
		const commands = steps.flatMap((step) => (step.run === undefined ? [] : shellLines(step.run)));
		const fetch = steps.find((step) => step.name === 'Fetch current pull request');
		expect(commands).toEqual([
			'set -euo pipefail',
			'gh api --method GET "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" > "$RUNNER_TEMP/pull-request.json"',
			'bun scripts/english-policy/pr-metadata.bundle.mjs --pr-json "$RUNNER_TEMP/pull-request.json"'
		]);
		expect(fetch?.env).toEqual({
			GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
			PR_NUMBER: '${{ github.event.pull_request.number }}'
		});
		expect(source).not.toMatch(/bun install|cache|artifact/i);
		expect(source).not.toMatch(/pull_request\.(?:title|body|head)|github\.head_ref/);
	});

	it('keeps the standalone bundle generated from the reviewed source', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'english-policy-bundle-'));
		const generated = path.join(directory, 'pr-metadata.bundle.mjs');
		try {
			const build = spawnSync(
				testExecutable('bun'),
				['build', ENTRY_PATH, '--target=bun', '--minify', `--outfile=${generated}`],
				{ cwd: ROOT, encoding: 'utf8' }
			);
			expect(build.status, build.stderr).toBe(0);
			expect(readFileSync(generated, 'utf8')).toBe(readFileSync(BUNDLE_PATH, 'utf8'));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
