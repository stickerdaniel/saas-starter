import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import toolingConfig from '../vitest.tooling.config.ts';
import { toolingTestSettings } from './vitest-settings.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');

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
	expect(gate.needs).toEqual(['verify', 'generated-project']);
	expect(normalizedCondition(gate)).toBe(MAIN_ONLY);
	expect(gate.permissions).toEqual({ contents: 'read' });

	for (const [id, job] of Object.entries(jobs)) {
		if (id === 'publish') continue;
		expect(job.permissions ?? {}).not.toHaveProperty('id-token');
		expect(job.concurrency).toBeUndefined();
	}
}

const ROOT_TESTS_RUN = 'bun vitest --config vitest.tooling.config.ts --run ';
const PACKAGE_TESTS_RUN = 'bun run --cwd packages/create-saas-starter vitest --run ';
const SELECTOR_ASSIGNMENT = /^(?:runner|test)_pattern='/;
const TEST_NAME_OPTION = / -t '[^']*'$/;
const ROOT_TEST_FILE = /^scripts\/[\w./-]+\.test\.ts$/;

const READ_FROM_THE_CHECKOUT = {
	'scripts/create-saas-starter.integration.test.ts': [
		'scripts/__fixtures__/template-setup/package.json',
		'scripts/__fixtures__/template-setup/bun.lock',
		'scripts/__fixtures__/template-setup/README.md',
		'scripts/__fixtures__/template-setup/wrangler.toml',
		'scripts/__fixtures__/template-setup/src/lib/config/legal.ts',
		'scripts/__fixtures__/template-setup/src/lib/config/site.ts',
		'scripts/__fixtures__/template-setup/src/lib/content/legal-content-dates.ts',
		'scripts/template-setup.ts',
		'scripts/export-profile.ts',
		'scripts/path-sets.ts',
		'src/lib/content/legal-metadata.ts',
		'static/manifest.webmanifest',
		'src/app.html'
	],
	'scripts/create-saas-starter-marker-format.test.ts': ['.prettierrc', '.prettierignore'],
	'scripts/create-saas-starter-release-gate.test.ts': [
		'packages/create-saas-starter/package.json',
		'packages/create-saas-starter/src/options.ts',
		'.github/workflows/create-saas-starter.yml'
	],
	'scripts/create-saas-starter-workflows.test.ts': [
		'.github/workflows/create-saas-starter.yml',
		'.github/workflows/static-checks.yml',
		'.github/workflows/windows-process-lifecycle.yml'
	],
	'scripts/third-party-licenses/kit-build.test.ts': [
		'scripts/third-party-licenses/index.ts',
		'scripts/third-party-licenses/collect.ts',
		'scripts/third-party-licenses/config.ts',
		'scripts/third-party-licenses/generated.ts',
		'scripts/third-party-licenses/inputs.ts',
		'scripts/third-party-licenses/resolve.ts',
		'scripts/third-party-licenses/serialize.ts'
	]
} as const satisfies Record<string, readonly string[]>;

type GuardedRootTest = keyof typeof READ_FROM_THE_CHECKOUT;

const CREATOR_WORKFLOW_TESTS: GuardedRootTest[] = [
	'scripts/create-saas-starter.integration.test.ts',
	'scripts/create-saas-starter-marker-format.test.ts',
	'scripts/create-saas-starter-release-gate.test.ts',
	'scripts/create-saas-starter-workflows.test.ts'
];
const WINDOWS_JOB_TESTS: GuardedRootTest[] = [
	'scripts/third-party-licenses/kit-build.test.ts',
	'scripts/create-saas-starter.integration.test.ts'
];

const RUNS_TESTS = "steps.changes.outputs.run_tests == 'true'";
const CREATOR_STEP_CONDITIONS = [undefined];
const WINDOWS_STEP_CONDITIONS = [
	RUNS_TESTS,
	`${RUNS_TESTS} && hashFiles('packages/create-saas-starter/package.json') != ''`
];

const ROOT_TEST_STEP_KEYS = ['env', 'if', 'name', 'run'];
const ROOT_TEST_STEP_ENV = ['CREATE_SAAS_STARTER_RELEASE_GATE_TEST', 'TEMP', 'TMP'];
const SETTINGS_A_STEP_INHERITS = ['env', 'defaults', 'continue-on-error'] as const;

type InheritedSettings = Partial<Record<(typeof SETTINGS_A_STEP_INHERITS)[number], unknown>>;

interface WorkflowSteps extends InheritedSettings {
	jobs: Record<
		string,
		InheritedSettings & {
			steps?: Array<{ run?: string; if?: string; env?: Record<string, unknown> }>;
		}
	>;
}

function rootTests(
	workflow: WorkflowSteps,
	conditions: ReadonlyArray<string | undefined>
): string[] {
	return Object.values(workflow.jobs).flatMap((job) =>
		(job.steps ?? []).flatMap((step) =>
			(step.run?.split('\n') ?? [])
				.map((command) => command.trim())
				.filter(
					(command) =>
						command.includes('vitest') &&
						!command.startsWith(PACKAGE_TESTS_RUN) &&
						!SELECTOR_ASSIGNMENT.test(command)
				)
				.flatMap((command) => {
					expect(command.startsWith(ROOT_TESTS_RUN), command).toBe(true);
					expect(step.run?.trim(), command).toBe(command);
					expect(conditions, command).toContain(step.if);
					expect(ROOT_TEST_STEP_KEYS, command).toEqual(expect.arrayContaining(Object.keys(step)));
					expect(ROOT_TEST_STEP_ENV, command).toEqual(
						expect.arrayContaining(Object.keys(step.env ?? {}))
					);
					for (const setting of SETTINGS_A_STEP_INHERITS) {
						expect(workflow[setting], `${setting} of the workflow of ${command}`).toBeUndefined();
						expect(job[setting], `${setting} of the job of ${command}`).toBeUndefined();
					}
					const files = command
						.slice(ROOT_TESTS_RUN.length)
						.replace(TEST_NAME_OPTION, '')
						.split(' ');
					for (const file of files) {
						expect(file, command).toMatch(ROOT_TEST_FILE);
						expect(path.posix.normalize(file), command).toBe(file);
					}
					return TEST_NAME_OPTION.test(command) ? [] : files;
				})
		)
	);
}

function isFile(relative: string): boolean {
	return (
		statSync(path.join(REPOSITORY_ROOT, relative), { throwIfNoEntry: false })?.isFile() ?? false
	);
}

function sourcesImportedFrom(seeds: readonly string[]): string[] {
	const sources = new Set<string>();
	const pending = [...seeds];
	for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
		if (sources.has(file)) continue;
		sources.add(file);
		if (!file.endsWith('.ts')) continue;
		for (const { fileName } of ts.preProcessFile(read(file), true, true).importedFiles) {
			if (!fileName.startsWith('.')) continue;
			const target = path.posix.join(path.posix.dirname(file), fileName);
			const source = [target, target.replace(/\.js$/, '.ts'), `${target}.ts`].find(isFile);
			if (source === undefined) throw new Error(`${file} imports ${fileName}, which is no file`);
			pending.push(source);
		}
	}
	return [...sources];
}

function inputsOf(tests: readonly GuardedRootTest[]): string[] {
	const { tsconfig } = toolingConfig;
	if (tsconfig === undefined) throw new Error('vitest.tooling.config.ts names no tsconfig');
	return [
		path.posix.normalize(tsconfig),
		...sourcesImportedFrom([
			'vitest.tooling.config.ts',
			...toolingTestSettings.setupFiles.map((file) =>
				path.relative(REPOSITORY_ROOT, file).split(path.sep).join('/')
			),
			...tests
		]),
		...tests.flatMap((test) => READ_FROM_THE_CHECKOUT[test])
	];
}

function selects(paths: readonly string[], input: string): boolean {
	return paths.some((entry) =>
		entry.endsWith('/**') ? input.startsWith(entry.slice(0, -2)) : entry === input
	);
}

describe('creator workflows', () => {
	it('starts the creator workflow and the Windows job on every input of the root tests they run', () => {
		expect(new Set([...CREATOR_WORKFLOW_TESTS, ...WINDOWS_JOB_TESTS])).toEqual(
			new Set(Object.keys(READ_FROM_THE_CHECKOUT))
		);
		const creator = parseYaml(
			read('.github/workflows/create-saas-starter.yml')
		) as WorkflowSteps & {
			on: { push: { paths: string[] }; pull_request: { paths: string[] } };
		};
		expect(rootTests(creator, CREATOR_STEP_CONDITIONS)).toEqual(CREATOR_WORKFLOW_TESTS);
		for (const input of inputsOf(CREATOR_WORKFLOW_TESTS)) {
			expect(isFile(input), `a file: ${input}`).toBe(true);
			expect(selects(creator.on.push.paths, input), `push: ${input}`).toBe(true);
			expect(selects(creator.on.pull_request.paths, input), `pull_request: ${input}`).toBe(true);
		}

		const windows = read('.github/workflows/windows-process-lifecycle.yml');
		const selectsWindows = windows.match(/^ {10}runner_pattern='([^']+)'$/m)?.[1];
		const runsTests = windows.match(/^ {10}test_pattern='([^']+)'$/m)?.[1];
		expect(
			rootTests(parseYaml(windows) as WorkflowSteps, WINDOWS_STEP_CONDITIONS).filter(
				(test) => test in READ_FROM_THE_CHECKOUT
			)
		).toEqual(WINDOWS_JOB_TESTS);
		expect(selectsWindows).toBeDefined();
		expect(runsTests).toBeDefined();
		for (const input of inputsOf(WINDOWS_JOB_TESTS)) {
			expect(new RegExp(selectsWindows!).test(input), `native runner: ${input}`).toBe(true);
			expect(new RegExp(runsTests!).test(input), `tests: ${input}`).toBe(true);
		}
	});

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
			verify.steps.find(
				(step) =>
					step.run ===
					'bun vitest --config vitest.tooling.config.ts --run scripts/create-saas-starter.integration.test.ts scripts/create-saas-starter-marker-format.test.ts scripts/create-saas-starter-release-gate.test.ts scripts/create-saas-starter-workflows.test.ts'
			)?.env
		).toEqual({ CREATE_SAAS_STARTER_RELEASE_GATE_TEST: '${{ matrix.release_gate_test }}' });
	});

	it('publishes only from the credential-isolated npm job after the release gate', () => {
		const source = read('.github/workflows/create-saas-starter.yml');
		expect(source).not.toMatch(/\bbun\s+publish\b/);
		expect(source).not.toMatch(/secrets\.\w*TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN/);
		expectCredentialIsolatedRelease(parseYaml(source) as ReleaseWorkflow);
	});

	it('checks both profiles generated by the recorded tarball before the release gate', () => {
		const { jobs } = parseYaml(read('.github/workflows/create-saas-starter.yml')) as {
			jobs: Record<
				string,
				{
					needs?: string | string[];
					strategy?: { matrix: { include: Array<{ flag: string }> } };
					steps: Array<{ run?: string }>;
				}
			>;
		};
		const generated = jobs['generated-project']!;
		const runs = generated.steps.map((step) => normalizedRun(step.run));

		expect(jobs['release-gate']!.needs).toContain('generated-project');
		expect(generated.needs).toBe('verify');
		expect(generated.strategy?.matrix.include.map((entry) => entry.flag)).toEqual([
			'--without-tests',
			''
		]);
		expect(
			runs.find((run) => run?.includes('npx --yes --package "$tarball" create-saas-starter'))
		).toContain('sha256sum "$tarball"');
		expect(runs.slice(-5)).toEqual([
			'bun install --frozen-lockfile',
			'bun run check',
			'bun run lint',
			'bun run knip',
			'bun run build'
		]);
	});

	it('installs the frozen locks before static and Windows checks', () => {
		const { jobs } = parseYaml(read('.github/workflows/static-checks.yml')) as ReleaseWorkflow;
		const windowsLifecycle = read('.github/workflows/windows-process-lifecycle.yml');
		// Each job's first Bun command must install the frozen lock, so no check runs on a stale or rewritten one.
		// Jobs that read nothing postinstall generates may skip the install scripts.
		// A selection that decides whether the checks run imports Node built-ins only
		// (scripts/upstream-report-scope.contract.test.ts holds that), so it reads no lock.
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
