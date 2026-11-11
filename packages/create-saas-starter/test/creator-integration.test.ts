import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');

const SETUP_NODE = 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1';
const DOWNLOAD_ARTIFACT = 'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333';
const MAIN_ONLY =
	"github.repository == 'stickerdaniel/saas-starter' && " +
	"(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && " +
	"github.ref == 'refs/heads/main'";

interface WorkflowJob {
	if?: string;
	needs?: string | string[];
	permissions?: Record<string, string>;
	environment?: string | { name: string };
	concurrency?: unknown;
	steps: Array<{ name?: string; uses?: string; run?: string }>;
}

interface ReleaseWorkflow {
	permissions: unknown;
	jobs: Record<string, WorkflowJob>;
}

function read(relative: string): string {
	return readFileSync(path.join(REPOSITORY_ROOT, relative), 'utf8');
}

function normalizedCondition(job: WorkflowJob): string | undefined {
	return job.if?.replace(/\s+/g, ' ').trim();
}

// Newlines and indentation separate shell commands, so only line endings and
// one final newline are normalized.
function normalizedRun(run: string | undefined): string | undefined {
	return run?.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

const REQUIRE_NPM_RUN = [
	'set -euo pipefail',
	'npm_version="$(npm --version)"',
	`printf '11.5.1\\n%s\\n' "$npm_version" | sort -V -C || {`,
	'  echo "::error::npm $npm_version is older than 11.5.1, which trusted publishing requires."',
	'  exit 1',
	'}'
].join('\n');

const PUBLISH_RUN = [
	'set -euo pipefail',
	'tarball="$RELEASE_DIR/create-saas-starter-$VERSION.tgz"',
	`[ "$(sha256sum "$tarball" | cut -d' ' -f1)" = "$SHA256" ] || {`,
	'  echo "::error::$tarball is not the tarball the release gate checked."',
	'  exit 1',
	'}',
	'npm publish "$tarball" --access public --ignore-scripts --registry https://registry.npmjs.org/',
	'{',
	'  echo "Published create-saas-starter@$VERSION"',
	'  echo',
	'  echo "Tarball sha256: \\`$SHA256\\`"',
	'} >> "$GITHUB_STEP_SUMMARY"'
].join('\n');

function expectCredentialIsolatedRelease({ permissions, jobs }: ReleaseWorkflow): void {
	expect(permissions).toEqual({ contents: 'read' });
	const publishSteps = Object.entries(jobs).flatMap(([id, job]) =>
		job.steps.filter((step) => /\bnpm\s+publish\b/.test(step.run ?? '')).map(() => id)
	);
	expect(publishSteps).toEqual(['publish']);

	const publish = jobs.publish!;
	expect(publish.needs).toEqual(['verify', 'release-gate']);
	expect(normalizedCondition(publish)).toBe(
		`${MAIN_ONLY} && needs.release-gate.outputs.publish == 'true'`
	);
	expect(publish.permissions).toEqual({ 'id-token': 'write' });
	expect(
		typeof publish.environment === 'string' ? publish.environment : publish.environment?.name
	).toBe('npm');
	expect(publish.concurrency).toEqual({
		group: 'create-saas-starter-npm-release',
		'cancel-in-progress': false
	});
	// Every step of the credentialed job is pinned or reviewed here, so a new
	// action or command cannot join the job without failing this list, and
	// each run block must match its complete reviewed text.
	expect(publish.steps.map((step) => (step.uses ? step.uses : `run: ${step.name ?? ''}`))).toEqual([
		SETUP_NODE,
		'run: Require npm with trusted publishing support',
		DOWNLOAD_ARTIFACT,
		'run: Publish the tested tarball'
	]);
	expect(normalizedRun(publish.steps[1]!.run)).toBe(REQUIRE_NPM_RUN);
	expect(normalizedRun(publish.steps[3]!.run)).toBe(PUBLISH_RUN);

	const gate = jobs['release-gate']!;
	expect(gate.needs).toBe('verify');
	expect(normalizedCondition(gate)).toBe(MAIN_ONLY);
	expect(gate.permissions).toEqual({ contents: 'read' });

	for (const [id, job] of Object.entries(jobs)) {
		if (id === 'publish') continue;
		expect(job.permissions ?? {}).not.toHaveProperty('id-token');
		expect(job.concurrency).toBeUndefined();
	}
}

describe('creator workflows', () => {
	it('requires the release gate test only on the entry with the release npm', () => {
		type Step = {
			uses?: string;
			run?: string;
			with?: Record<string, string>;
			env?: Record<string, string>;
		};
		const {
			verify,
			'release-gate': releaseGate,
			publish
		} = (
			parseYaml(read('.github/workflows/create-saas-starter.yml')) as {
				jobs: {
					verify: {
						strategy: { matrix: { include: Array<Record<string, unknown>> } };
						steps: Step[];
					};
					'release-gate': { steps: Step[] };
					publish: { steps: Step[] };
				};
			}
		).jobs;
		const required = verify.strategy.matrix.include.filter(
			(entry) => entry.release_gate_test !== undefined
		);
		// The release gate tests load tar and pacote from the npm bundled with Node,
		// so the required entry must run the Node the release jobs publish with.
		const nodeOf = (steps: Step[]) =>
			steps.find((step) => step.uses?.startsWith('actions/setup-node@'))?.with?.['node-version'];
		const releaseNode = nodeOf(publish.steps);

		expect(releaseNode).toBeDefined();
		expect(nodeOf(releaseGate.steps)).toBe(releaseNode);
		expect(required).toEqual([
			expect.objectContaining({ node: releaseNode, artifact: true, release_gate_test: 'required' })
		]);
		expect(
			verify.steps.find((step) => step.run === 'bun run --cwd packages/create-saas-starter test')
				?.env
		).toEqual({ CREATE_SAAS_STARTER_RELEASE_GATE_TEST: '${{ matrix.release_gate_test }}' });
	});

	it('publishes only from the credential-isolated npm job after the release gate', () => {
		const source = read('.github/workflows/create-saas-starter.yml');
		expect(source).not.toMatch(/\bbun\s+publish\b/);
		expect(source).not.toMatch(/secrets\.\w*TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN/);
		expectCredentialIsolatedRelease(parseYaml(source) as ReleaseWorkflow);
	});

	it('installs the frozen locks before static and Windows checks', () => {
		const { jobs } = parseYaml(read('.github/workflows/static-checks.yml')) as ReleaseWorkflow;
		const windowsLifecycle = read('.github/workflows/windows-process-lifecycle.yml');
		// Each job's first Bun command must install the frozen lock, so no check runs on a stale or rewritten one.
		// Jobs that read nothing postinstall generates may skip the install scripts.
		// A selection that decides whether the checks run imports Node built-ins only
		// (scripts/upstream-report-scope.test.ts holds that), so it reads no lock.
		const preInstallSelections = new Set(['bun scripts/upstream-report-scope.ts']);
		const firstBunRuns = Object.entries(jobs).flatMap(([id, job]) => {
			const run = job.steps
				.map((step) => normalizedRun(step.run))
				.find(
					(command) =>
						command !== undefined && /^bunx? /m.test(command) && !preInstallSelections.has(command)
				);
			return run === undefined ? [] : [[id, run] as const];
		});

		expect(firstBunRuns.length).toBeGreaterThan(0);
		for (const [id, run] of firstBunRuns) {
			expect(run, id).toMatch(/^bun install --frozen-lockfile(?: --ignore-scripts)?$/);
		}
		expect(windowsLifecycle).toContain('packages/create-saas-starter/.*');
		expect(windowsLifecycle).toContain(
			'run: bun install --cwd packages/create-saas-starter --frozen-lockfile --ignore-scripts'
		);
		expect(windowsLifecycle).toContain(
			'run: bun run --cwd packages/create-saas-starter vitest --run test/process.test.ts test/lifecycle.test.ts'
		);
	});
});
