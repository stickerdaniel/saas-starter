import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/require-english-pr.yml');
const BUNDLE_PATH = path.join(ROOT, 'scripts/english-policy/pr-metadata.bundle.mjs');
const ENTRY_PATH = path.join(ROOT, 'scripts/english-policy/pr-metadata.ts');
const CLASSIFIER_PATH = path.join(ROOT, 'scripts/english-policy/classifier.ts');
const ELD_LICENSE_PATH = path.join(ROOT, 'scripts/english-policy/ELD-LICENSE.txt');
const THIRD_PARTY_NOTICES_PATH = path.join(ROOT, 'scripts/english-policy/THIRD-PARTY-NOTICES.md');
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

function policyErrors(workflow: Workflow): string[] {
	const errors: string[] = [];
	const trigger = workflow.on?.pull_request_target;
	if (
		JSON.stringify(trigger?.types) !==
		JSON.stringify(['opened', 'edited', 'reopened', 'synchronize'])
	) {
		errors.push('trigger');
	}
	if (
		JSON.stringify(workflow.permissions) !==
		JSON.stringify({ contents: 'read', 'pull-requests': 'read' })
	) {
		errors.push('permissions');
	}
	if (workflow.concurrency?.group !== 'english-pr-${{ github.event.pull_request.number }}') {
		errors.push('concurrency group');
	}
	if (workflow.concurrency?.['cancel-in-progress'] !== true) {
		errors.push('concurrency cancellation');
	}
	const steps = workflow.jobs?.['english-metadata']?.steps ?? [];
	const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
	if (checkout?.with?.ref !== '${{ github.workflow_sha }}') errors.push('checkout ref');
	if (checkout?.with?.['persist-credentials'] !== false) errors.push('checkout credentials');
	const fetch = steps.find((step) => step.name === 'Fetch current pull request');
	if (
		fetch?.env?.GH_TOKEN !== '${{ secrets.GITHUB_TOKEN }}' ||
		fetch.env.PR_NUMBER !== '${{ github.event.pull_request.number }}' ||
		!fetch.run?.includes('gh api --method GET') ||
		!fetch.run.includes('> "$RUNNER_TEMP/pull-request.json"')
	) {
		errors.push('metadata fetch');
	}
	if (
		!steps.some(
			(step) =>
				step.run ===
				'bun scripts/english-policy/pr-metadata.bundle.mjs --pr-json "$RUNNER_TEMP/pull-request.json"'
		)
	) {
		errors.push('policy command');
	}
	return errors;
}

const workflow = parseYaml(source) as Workflow;
const steps = workflow.jobs?.['english-metadata']?.steps ?? [];

describe('English pull request workflow', () => {
	it('uses the metadata-only trigger and minimal permissions', () => {
		expect(policyErrors(workflow)).toEqual([]);
	});

	it('warns that SHA-like source branches require a replacement pull request', () => {
		expect(source).toContain(
			'# GitHub suppresses pull_request_target for SHA-like source branch names.'
		);
		expect(source).toContain('Open a replacement pull');
		expect(source).toContain('request from a non-SHA-like source branch so this check can run.');
	});

	it('cancels stale runs for the same pull request', () => {
		expect(workflow.concurrency).toEqual({
			group: 'english-pr-${{ github.event.pull_request.number }}',
			'cancel-in-progress': true
		});
	});

	it('checks out only the trusted workflow revision without credentials', () => {
		const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
		expect(checkout?.with).toMatchObject({
			ref: '${{ github.workflow_sha }}',
			'persist-credentials': false,
			'fetch-depth': 1
		});
		expect(source).not.toContain('pull_request.head');
		expect(source).not.toContain('github.head_ref');
		expect(source).not.toContain('refs/pull/');
	});

	it('pins every action to a full commit SHA', () => {
		const actions = steps.filter((step) => step.uses).map((step) => step.uses!);
		expect(actions.length).toBeGreaterThan(0);
		for (const action of actions) expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
	});

	it('fetches private metadata with the ephemeral token and passes only its temp file', () => {
		const commands = steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));
		const fetch = steps.find((step) => step.name === 'Fetch current pull request');
		const entry = readFileSync(ENTRY_PATH, 'utf8');
		expect(commands).toEqual([
			[
				'set -euo pipefail',
				'gh api --method GET \\',
				'  "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" \\',
				'  > "$RUNNER_TEMP/pull-request.json"',
				''
			].join('\n'),
			'bun scripts/english-policy/pr-metadata.bundle.mjs --pr-json "$RUNNER_TEMP/pull-request.json"'
		]);
		expect(fetch?.env).toEqual({
			GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
			PR_NUMBER: '${{ github.event.pull_request.number }}'
		});
		expect(source).not.toMatch(/bun install|cache|artifact/i);
		expect(source).not.toMatch(/pull_request\.(?:title|body|head)|github\.head_ref/);
		expect(source).not.toMatch(/(?:cat|tee|printf|echo).*pull-request\.json/);
		expect(source).not.toContain('set -x');
		expect(entry).toContain('readCurrentPullRequest(options.prJsonPath');
		expect(entry).toContain('statSync(prJsonPath).size > MAX_RESPONSE_BYTES');
		expect(entry).toContain('value.base.repo.full_name !== expectedRepository');
		expect(entry).not.toMatch(/Authorization|process\.env\.(?:GH_TOKEN|GITHUB_TOKEN)/);
	});

	it('fails the structural policy when the trusted checkout route is removed', () => {
		const mutated = structuredClone(workflow);
		const checkout = mutated.jobs?.['english-metadata']?.steps?.find((step) =>
			step.uses?.startsWith('actions/checkout@')
		);
		if (checkout?.with) delete checkout.with.ref;
		expect(policyErrors(mutated)).toContain('checkout ref');
	});

	it('ships the license and attribution for the detector embedded in the bundle', () => {
		const classifier = readFileSync(CLASSIFIER_PATH, 'utf8');
		const eldPackagePath = path.join(ROOT, 'node_modules/eld/package.json');
		const eldPackage = JSON.parse(readFileSync(eldPackagePath, 'utf8')) as {
			name: string;
			version: string;
			license: string;
			files: string[];
		};
		const packageDirectory = path.dirname(eldPackagePath);
		const attribution = readFileSync(THIRD_PARTY_NOTICES_PATH, 'utf8');

		expect(classifier).toContain("from 'eld/extrasmall'");
		expect(eldPackage).toMatchObject({ name: 'eld', version: '2.1.0', license: 'Apache-2.0' });
		expect(readFileSync(ELD_LICENSE_PATH, 'utf8')).toBe(
			readFileSync(path.join(packageDirectory, 'LICENSE'), 'utf8')
		);
		expect(attribution).toContain('Efficient Language Detector (ELD) 2.1.0 by Nito T.M.');
		expect(attribution).toContain('ELD-LICENSE.txt');
		expect(eldPackage.files).not.toContain('NOTICE');
		expect(existsSync(path.join(packageDirectory, 'NOTICE'))).toBe(false);
	});

	it('keeps the standalone bundle generated from the reviewed source', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'english-policy-bundle-'));
		const generated = path.join(directory, 'pr-metadata.bundle.mjs');
		try {
			const build = spawnSync(
				'bun',
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
