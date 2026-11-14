import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	APP_TYPES,
	BUN,
	CLI_KNIP,
	CLI_TYPES,
	CONVEX_TYPES,
	KNIP,
	PRETTIER_README,
	TEMP_ROOT,
	cliKnipInvocations,
	configureFixtureGitIdentity,
	createRecorderShims,
	indexOfInvocation,
	knipInvocations,
	knipSuite,
	overlayIndexedSources,
	readCommandLog,
	runChecker,
	runFixtureGit,
	shellSingleQuote,
	stageRemoval,
	type CanaryOutcome,
	type CheckerClone,
	type CommandInvocation,
	type SharedKitState
} from './__fixtures__/static-checks/knip-harness';
import { sanitizedGitEnv } from './git-context';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRETTIER_WRITE: CommandInvocation = {
	command: 'bun',
	args: ['prettier', '--write', '--ignore-unknown', '--', 'README.md', 'scripts/test-executable.ts']
};
const ESLINT_FIX: CommandInvocation = {
	command: 'bun',
	args: ['eslint', '--fix', 'scripts/test-executable.ts']
};
const WINDOWS_LIFECYCLE_WORKFLOW = path.join(
	ROOT,
	'.github',
	'workflows',
	'windows-process-lifecycle.yml'
);
const WINDOWS_LIFECYCLE_DEPENDENCIES = [
	'package.json',
	'bun.lock',
	'packages/create-saas-starter/package.json',
	'packages/create-saas-starter/bun.lock',
	'packages/create-saas-starter/src/process.ts',
	'packages/create-saas-starter/test/lifecycle.test.ts',
	'tsconfig.json',
	'tsconfig.tooling.json',
	'vitest.tooling.config.ts',
	'scripts/vitest-settings.ts',
	'scripts/template-setup.ts',
	'scripts/template-setup.integration.test.ts',
	'scripts/__fixtures__/template-setup/package.json',
	'scripts/__fixtures__/template-setup/legal-content-dates.ts',
	'src/lib/content/legal-metadata.ts',
	'src/lib/config/legal.ts',
	'src/lib/config/site.ts',
	'README.md',
	'wrangler.toml',
	'packages/create-saas-starter/scripts/test-packed.ts',
	'knowledge-policy.config.ts',
	'eslint/control-character-policy.js',
	'scripts/knowledge-policy/example.ts',
	'scripts/english-policy/example.ts',
	'src/lib/i18n/language-codes.generated.js',
	'scripts/dev-cloud.ts',
	'scripts/dev-cloud.test.ts',
	'scripts/git-context.ts',
	'scripts/git-context.test.ts',
	'scripts/private-checkout.test.ts',
	'scripts/__fixtures__/static-checks/private-checkout.ts',
	'scripts/static-checks.ts',
	'scripts/static-checks.test.ts',
	'scripts/static-checks.processes.test.ts',
	'scripts/static-checks.knip.test.ts',
	'scripts/static-checks.knip-cli.test.ts',
	'scripts/static-checks.knip-types.test.ts',
	'scripts/svelte-kit-sync-lock.ts',
	'scripts/svelte-kit-sync-lock.test.ts',
	'scripts/terminal-output.ts',
	'scripts/test-executable.ts',
	'scripts/__fixtures__/static-checks/command-recorder.ts',
	'scripts/__fixtures__/static-checks/knip-harness.ts',
	'scripts/windows-job.ts',
	'scripts/windows-job-runner.ps1'
];
// A tracked TypeScript file that the local pre-push run passes to the mutating linters;
// with only Markdown input, the checker skips ESLint entirely.
const LINTED_SOURCE = 'scripts/test-executable.ts';

interface WorkflowSelectorOutcome {
	status: number | null;
	output: string;
	values: Record<string, string>;
}

function windowsLifecycleRunnerScript(workflow: string): string {
	const script = workflow.match(
		/^ {6}- name: Select runner\n[\s\S]*?^ {8}run: \|\n([\s\S]*?)^ {2}lifecycle:/m
	)?.[1];
	if (!script) throw new Error('Windows lifecycle runner script was not found.');
	return script.replace(/^ {10}/gm, '').trimEnd();
}

function runWindowsLifecycleSelectorFixture(
	pages: unknown,
	changedFiles: string,
	apiStatus = 0
): WorkflowSelectorOutcome {
	const directory = mkdtempSync(path.join(TEMP_ROOT, 'windows-lifecycle-'));
	const outputPath = path.join(directory, 'github-output');
	const gh = path.join(directory, 'gh');
	writeFileSync(
		gh,
		'#!/bin/sh\nprintf \'%s\\n\' "$WINDOWS_LIFECYCLE_API_RESPONSE"\nexit "$WINDOWS_LIFECYCLE_API_STATUS"\n'
	);
	chmodSync(gh, 0o755);
	try {
		const workflow = readFileSync(WINDOWS_LIFECYCLE_WORKFLOW, 'utf8');
		const result = spawnSync(
			'bash',
			['-e', '-o', 'pipefail', '-c', windowsLifecycleRunnerScript(workflow)],
			{
				env: {
					...sanitizedGitEnv(),
					PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`,
					EVENT_NAME: 'pull_request',
					PR_NUMBER: '897',
					CHANGED_FILES: changedFiles,
					GITHUB_REPOSITORY: 'example/fixture',
					GITHUB_OUTPUT: outputPath,
					WINDOWS_LIFECYCLE_API_RESPONSE: JSON.stringify(pages),
					WINDOWS_LIFECYCLE_API_STATUS: String(apiStatus)
				},
				encoding: 'utf8'
			}
		);
		const values = existsSync(outputPath)
			? Object.fromEntries(
					readFileSync(outputPath, 'utf8')
						.trim()
						.split('\n')
						.filter(Boolean)
						.map((line) => {
							const separator = line.indexOf('=');
							return [line.slice(0, separator), line.slice(separator + 1)];
						})
				)
			: {};
		return {
			status: result.status,
			output: `${result.stdout}${result.stderr}`,
			values
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function rootIndexSnapshot(): string {
	const result = spawnSync('git', ['diff', '--cached', '--raw', '-z'], {
		cwd: ROOT,
		env: sanitizedGitEnv(),
		encoding: 'utf8'
	});
	if (result.status !== 0) throw new Error(`Root index snapshot failed: ${result.stderr}`);
	return result.stdout;
}

function stageReadme(checkout: CheckerClone): void {
	const readme = path.join(checkout.repository, 'README.md');
	writeFileSync(readme, `${readFileSync(readme, 'utf8')}\n`);
	const staged = spawnSync('git', ['add', '--', 'README.md'], {
		cwd: checkout.repository,
		env: sanitizedGitEnv(),
		encoding: 'utf8'
	});
	if (staged.status !== 0) throw new Error(`Fixture staging failed: ${staged.stderr}`);
	// Seeding the creator state rewrites tracked files and invalidates their index stat data.
	// Refresh it before the checker fingerprints the index, so Git cannot rewrite those fields
	// midway through the run.
	const refreshed = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
		cwd: checkout.repository,
		env: sanitizedGitEnv(),
		encoding: 'utf8'
	});
	if (refreshed.status !== 0) throw new Error(`Fixture index refresh failed: ${refreshed.stderr}`);
	const names = spawnSync('git', ['diff', '--cached', '--name-only', '-z'], {
		cwd: checkout.repository,
		env: sanitizedGitEnv(),
		encoding: 'utf8'
	});
	if (names.status !== 0 || names.stdout !== 'README.md\0') {
		throw new Error(`Unexpected fixture index: ${names.stdout}${names.stderr}`);
	}
}

function stageDeletionOnly(checkout: CheckerClone): void {
	const relative = 'scripts/__fixtures__/static-checks/deletion-only.md';
	const fixture = path.join(checkout.repository, relative);
	writeFileSync(fixture, 'Fixture deleted only from the private test repository.\n');
	runFixtureGit(checkout.repository, ['add', '--', relative]);
	configureFixtureGitIdentity(checkout.repository);
	runFixtureGit(checkout.repository, [
		'commit',
		'--quiet',
		'--no-gpg-sign',
		'-m',
		'Add deletion-only fixture',
		'--',
		relative
	]);
	rmSync(fixture);
	runFixtureGit(checkout.repository, ['add', '-u', '--', relative]);
}

function replaceCompatWithRecorder(checkout: CheckerClone): void {
	writeFileSync(
		path.join(checkout.repository, 'scripts', 'convex-consumer-compat.ts'),
		`import { appendFileSync } from 'node:fs';

const logPath = process.env.STATIC_CHECKS_COMMAND_LOG;
if (!logPath) throw new Error('Static-check command log is not configured.');
appendFileSync(logPath, JSON.stringify({ command: 'compat', args: process.argv.slice(2) }) + '\\n');
`
	);
}

const suite = knipSuite();
const { createCheckerClone, recorderEnv } = suite;
let checkerTemplateRepository: string;
let bunVersion: string;
let canary: CanaryOutcome;
let sharedKitStateBefore: SharedKitState;
let sharedKitStateAfter: SharedKitState;
let templateAppBeforeSeed: boolean;

beforeAll(() => {
	({
		checkerTemplateRepository,
		bunVersion,
		canary,
		sharedKitStateBefore,
		sharedKitStateAfter,
		templateAppBeforeSeed
	} = suite.setUp());
}, 120_000);

afterAll(() => suite.tearDown());

describe('checker template dependencies', () => {
	it('seeds SvelteKit output in the template and leaves this checkout unchanged', () => {
		const app = path.join(checkerTemplateRepository, 'node_modules', '$app');
		expect(templateAppBeforeSeed).toBe(false);
		expect(lstatSync(app).isDirectory()).toBe(true);
		expect(realpathSync(path.join(app, 'tsconfig.json'))).toBe(
			path.join(realpathSync(checkerTemplateRepository), 'node_modules', '$app', 'tsconfig.json')
		);
		expect(sharedKitStateAfter).toEqual(sharedKitStateBefore);
	});
});

describe('Windows lifecycle workflow coverage', () => {
	it.skipIf(process.platform === 'win32')(
		'fails the required check instead of skipping it when runner selection fails',
		() => {
			const workflow = readFileSync(WINDOWS_LIFECYCLE_WORKFLOW, 'utf8');
			const lifecycle = workflow.slice(workflow.indexOf('\n  lifecycle:\n'));
			expect(lifecycle).toMatch(/^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
			const gate = lifecycle.split(/^ {6}- /m)[1]!;
			expect(gate).toContain('name: Require a runner selection');
			const script = gate
				.split('run: |\n')[1]!
				.split('\n')
				.map((line) => line.slice(10))
				.join('\n');
			for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
				const outcome = spawnSync('bash', ['-e', '-c', script], {
					env: { PATH: process.env.PATH ?? '', RUNNER_RESULT: result },
					encoding: 'utf8'
				});
				expect(outcome.status, `runner result ${JSON.stringify(result)}`).toBe(
					result === 'success' ? 0 : 1
				);
			}
		}
	);
	it('runs only child steps when selected and the child manifest exists', () => {
		const steps = readFileSync(WINDOWS_LIFECYCLE_WORKFLOW, 'utf8')
			.split(/^ {6}- /m)
			.slice(1);
		const childCommands = [
			'bun install --cwd packages/create-saas-starter --frozen-lockfile --ignore-scripts',
			'bun run --cwd packages/create-saas-starter vitest --run test/process.test.ts test/lifecycle.test.ts'
		];
		for (const command of childCommands) {
			const step = steps.find((entry) => entry.includes(`run: ${command}\n`));
			expect(step).toBeDefined();
			expect(step).toContain(
				"if: steps.changes.outputs.run_tests == 'true' && hashFiles('packages/create-saas-starter/package.json') != ''"
			);
			const expression = step!.match(/^if: (.+)$/m)?.[1];
			for (const selected of [false, true])
				for (const present of [false, true]) {
					const actual =
						expression ===
							"steps.changes.outputs.run_tests == 'true' && hashFiles('packages/create-saas-starter/package.json') != ''" &&
						selected &&
						present;
					expect(actual, `${command}: selected=${selected}, present=${present}`).toBe(
						selected && present
					);
				}
		}
		for (const command of [
			'bun install --frozen-lockfile --ignore-scripts',
			'bun vitest --config vitest.tooling.config.ts --run scripts/static-checks.knip.test.ts scripts/static-checks.knip-cli.test.ts scripts/static-checks.knip-types.test.ts'
		]) {
			const step = steps.find((entry) => entry.includes(`run: ${command}\n`));
			expect(step).toContain("if: steps.changes.outputs.run_tests == 'true'");
			expect(step).not.toContain('hashFiles(');
		}
	});
	it('runs every root Vitest command from the standalone tooling config', () => {
		// The application config bootstraps Varlock; these tests need no SvelteKit environment.
		const commands = readFileSync(WINDOWS_LIFECYCLE_WORKFLOW, 'utf8').match(
			/^ +run: (?:bunx|bun(?: run)?) vitest\b.*$/gm
		);
		expect(commands?.length).toBeGreaterThan(0);
		for (const command of commands!) expect(command).toContain('--config vitest.tooling.config.ts');
	});
	it('keeps push, pull-request, and native-runner dependencies aligned', () => {
		const workflow = readFileSync(WINDOWS_LIFECYCLE_WORKFLOW, 'utf8');
		const pushBlock = workflow.match(/^ {2}push:\n([\s\S]*?)^ {2}pull_request:/m)?.[1];
		const selectorPattern = workflow.match(/^ {10}runner_pattern='([^']+)'$/m)?.[1];
		const testPattern = workflow.match(/^ {10}test_pattern='([^']+)'$/m)?.[1];

		expect(pushBlock, 'push trigger').toBeDefined();
		expect(pushBlock).not.toContain('paths:');
		expect(selectorPattern, 'native runner selector').toBeDefined();
		expect(testPattern, 'test selector').toBeDefined();
		expect(workflow.match(/gh api/g)).toHaveLength(1);
		expect(workflow).toContain('gh api --paginate --slurp');
		expect(workflow).toContain('CHANGED_FILES: ${{ github.event.pull_request.changed_files }}');
		expect(workflow).toContain('SELECTED_RUN_TESTS: ${{ needs.runner.outputs.run_tests }}');
		expect(workflow).toContain("if ($env:SELECTED_RUN_TESTS -notin @('true', 'false')) {");
		expect(workflow).toContain(
			'run: bun install --cwd packages/create-saas-starter --frozen-lockfile --ignore-scripts'
		);
		expect(workflow).toContain(
			'run: bun run --cwd packages/create-saas-starter vitest --run test/process.test.ts test/lifecycle.test.ts'
		);

		const selectsWindows = new RegExp(selectorPattern!);
		const runsTests = new RegExp(testPattern!);
		for (const dependency of WINDOWS_LIFECYCLE_DEPENDENCIES) {
			expect(selectsWindows.test(dependency), `native runner: ${dependency}`).toBe(true);
			expect(runsTests.test(dependency), `tests: ${dependency}`).toBe(true);
		}
		expect(selectsWindows.test('.github/workflows/windows-process-lifecycle.yml')).toBe(false);
		expect(runsTests.test('.github/workflows/windows-process-lifecycle.yml')).toBe(true);
		expect(selectsWindows.test('docs/example.md')).toBe(false);
		expect(runsTests.test('docs/example.md')).toBe(false);
	});

	it.skipIf(process.platform === 'win32')(
		'selects Windows tests when a dependency is renamed to an irrelevant path',
		() => {
			const outcome = runWindowsLifecycleSelectorFixture(
				[
					[
						{
							filename: 'docs/renamed.md',
							previous_filename: 'scripts/dev-cloud.ts'
						}
					]
				],
				'1'
			);

			expect(outcome.status, outcome.output).toBe(0);
			expect(outcome.output).toBe('');
			expect(outcome.values).toEqual({ label: 'windows-latest', run_tests: 'true' });
		}
	);

	it.skipIf(process.platform === 'win32')(
		'skips Windows tests for a complete irrelevant pull-request file list',
		() => {
			const outcome = runWindowsLifecycleSelectorFixture(
				[[{ filename: 'docs/first.md' }], [{ filename: 'docs/second.md' }]],
				'2'
			);

			expect(outcome.status, outcome.output).toBe(0);
			expect(outcome.output).toBe('');
			expect(outcome.values).toEqual({
				label: 'ubuntu-latest',
				run_tests: 'false'
			});
		}
	);

	it.skipIf(process.platform === 'win32')(
		'fails closed when the pull-request API file list is incomplete',
		() => {
			const outcome = runWindowsLifecycleSelectorFixture(
				[[{ filename: 'docs/only-returned-file.md' }]],
				'2'
			);

			expect(outcome.status, outcome.output).toBe(0);
			expect(outcome.values).toEqual({ label: 'windows-latest', run_tests: 'true' });
		}
	);

	it.skipIf(process.platform === 'win32').each([
		['an API failure', [[{ filename: 'docs/example.md' }]], '1', 23],
		['invalid pagination JSON', { filename: 'docs/example.md' }, '1', 0],
		['invalid changed-file metadata', [[{ filename: 'docs/example.md' }]], 'unknown', 0]
	] as const)('fails closed for %s', (_label, pages, changedFiles, apiStatus) => {
		const outcome = runWindowsLifecycleSelectorFixture(pages, changedFiles, apiStatus);

		expect(outcome.status, outcome.output).toBe(0);
		expect(outcome.values).toEqual({ label: 'windows-latest', run_tests: 'true' });
	});

	it.skipIf(process.platform === 'win32')(
		'combines complete pagination before selecting the runner and tests',
		() => {
			const outcome = runWindowsLifecycleSelectorFixture(
				[[{ filename: 'docs/example.md' }], [{ filename: 'scripts/dev-cloud.test.ts' }]],
				'2'
			);

			expect(outcome.status, outcome.output).toBe(0);
			expect(outcome.output).toBe('');
			expect(outcome.values).toEqual({ label: 'windows-latest', run_tests: 'true' });
		}
	);
});

describe('indexed source overlay', () => {
	it('removes the old path and copies the new path for a staged indirect-source rename', () => {
		const directory = mkdtempSync(path.join(TEMP_ROOT, 'static-overlay-'));
		const source = path.join(directory, 'source');
		const checkout = path.join(directory, 'checkout');
		const oldRelative = 'scripts/english-policy/old-name.ts';
		const newRelative = 'scripts/english-policy/new-name.ts';
		const rootIndex = rootIndexSnapshot();
		mkdirSync(path.dirname(path.join(source, oldRelative)), { recursive: true });
		runFixtureGit(source, ['init', '--quiet']);
		writeFileSync(path.join(source, oldRelative), 'export const fixture = "old";\n');
		runFixtureGit(source, ['add', '--', oldRelative]);
		configureFixtureGitIdentity(source);
		runFixtureGit(source, ['commit', '--quiet', '--no-gpg-sign', '-m', 'Add overlay fixture']);
		const cloned = spawnSync(
			'git',
			['clone', '--quiet', '--local', '--no-hardlinks', source, checkout],
			{
				env: sanitizedGitEnv(),
				encoding: 'utf8'
			}
		);
		if (cloned.status !== 0) throw new Error(`Overlay fixture clone failed: ${cloned.stderr}`);
		renameSync(path.join(source, oldRelative), path.join(source, newRelative));
		writeFileSync(path.join(source, newRelative), 'export const fixture = "new";\n');
		runFixtureGit(source, ['add', '-A', '--', 'scripts/english-policy']);
		try {
			overlayIndexedSources(checkout, source);

			expect(existsSync(path.join(checkout, oldRelative))).toBe(false);
			expect(readFileSync(path.join(checkout, newRelative), 'utf8')).toBe(
				'export const fixture = "new";\n'
			);
			expect(rootIndexSnapshot()).toBe(rootIndex);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe('Knip static-check CLI behavior', { concurrent: false }, () => {
	it('propagates local Autumn validation failures without dispatching a remote preview', () => {
		const checkout = createCheckerClone();
		const validation = { command: 'bun', args: ['scripts/check-autumn-config.ts'] };
		checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({
			...validation,
			status: 1,
			stderr: 'Invalid Autumn config\n'
		});
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'types']);
			const output = `${result.stdout}${result.stderr}`;
			const commands = readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!);
			expect(result.status, output).not.toBe(0);
			expect(commands).toContainEqual(validation);
			expect(commands.some((entry) => entry.args.includes('atmn'))).toBe(false);
			expect(output).toContain('Invalid Autumn config');
			expect(output).not.toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('resolves the recorder through the name the checker spawns', () => {
		const directory = mkdtempSync(path.join(TEMP_ROOT, 'static-recorder-contract-'));
		const logPath = path.join(directory, 'commands.jsonl');
		const env = recorderEnv(logPath);
		try {
			const bun = spawnSync('bun', ['prettier', '--check', 'README.md'], {
				env,
				encoding: 'utf8'
			});
			const context = `Bun ${BUN} (${bunVersion}): ${bun.stdout}${bun.stderr}`;

			expect(bun.status, context).toBe(0);
			expect(readCommandLog(logPath), context).toEqual([
				{ command: 'bun', args: ['prettier', '--check', 'README.md'] }
			]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'preserves argv through a Bun alias whose path contains spaces and quotes',
		() => {
			const directory = mkdtempSync(path.join(TEMP_ROOT, "static bun alias 'quoted' "));
			const aliasDirectory = path.join(directory, "bun alias 'quoted'");
			const shims = path.join(directory, 'shims');
			const logPath = path.join(directory, 'commands.jsonl');
			mkdirSync(aliasDirectory);
			mkdirSync(shims);
			const bunAlias = path.join(aliasDirectory, 'bun executable');
			symlinkSync(BUN, bunAlias);
			createRecorderShims(shims, bunAlias);
			const env = {
				...sanitizedGitEnv(),
				PATH: `${shims}${path.delimiter}${process.env.PATH ?? ''}`,
				STATIC_CHECKS_COMMAND_LOG: logPath,
				STATIC_CHECKS_COMMAND_RESPONSE: JSON.stringify({ ...PRETTIER_README, status: 23 })
			};
			try {
				const result = spawnSync('bun', PRETTIER_README.args, { env, encoding: 'utf8' });
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status, output).toBe(23);
				expect(readCommandLog(logPath), output).toEqual([PRETTIER_README]);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it('propagates a recorded formatter failure through the real CLI boundary', () => {
		expect(canary.status, canary.output).toBe(23);
		expect(canary.log).toEqual([PRETTIER_README]);
		expect(canary.output).toContain(
			'Command failed: bun prettier --check --ignore-unknown -- README.md'
		);
		expect(canary.output).not.toContain('All checks passed!');
	});

	it('keeps knip out of a successful format scope', () => {
		const checkout = createCheckerClone();
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'format', 'README.md']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([PRETTIER_README]);
			expect(knipInvocations(checkout)).toHaveLength(0);
			expect(cliKnipInvocations(checkout)).toHaveLength(0);
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 30_000);

	it.each([
		['the full CI gate', ['--ci'], undefined],
		['the full-project lint scope', ['--ci', '--scope', 'lint'], undefined],
		['a named lint file', ['--ci', '--scope', 'lint', 'README.md'], undefined],
		[
			'a nonempty files-from stream',
			['--ci', '--scope', 'lint', '--files-from', '-'],
			'README.md\0'
		]
	] as const)(
		'runs both Knip configs once in %s',
		(_label, args, input) => {
			const checkout = createCheckerClone();
			try {
				const result = runChecker(checkout, [...args], input);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status, output).toBe(0);
				expect(knipInvocations(checkout)).toEqual([KNIP]);
				expect(cliKnipInvocations(checkout)).toEqual([CLI_KNIP]);
				expect(output).toContain('All checks passed!');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	it('runs knip once in a local pre-push file run', () => {
		const checkout = createCheckerClone();
		// The documented pre-push invocation is `static-checks.ts <changed files>`: without --ci
		// and without CI in the environment. Only this case distinguishes the actual condition
		// `mode !== 'staged'` from a CI-only gate.
		delete checkout.env.CI;
		checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify([
			{ ...PRETTIER_WRITE, status: 0, delayMs: 300 },
			{ ...ESLINT_FIX, status: 0, delayMs: 300 }
		]);
		try {
			const result = runChecker(checkout, ['README.md', LINTED_SOURCE]);
			const output = `${result.stdout}${result.stderr}`;
			const log = readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!);

			expect(result.status, output).toBe(0);
			expect(knipInvocations(checkout)).toEqual([KNIP]);
			expect(cliKnipInvocations(checkout)).toEqual([CLI_KNIP]);
			// The second name resolved through PATH: only this case actually dispatches misspell and
			// proves that resolution does not work merely for bun.
			expect(log).toContainEqual({
				command: 'misspell',
				args: ['-error', 'README.md', LINTED_SOURCE]
			});

			// Outside --ci, Prettier (--write) and ESLint (--fix) write to the worktree. Delayed
			// recorders append only when those processes complete, so this compares completion rather
			// than start order. Knip must observe both completions before it reads the dependency graph.
			// Read-only checks may follow, so there is no contract that Knip is the final step.
			expect(log, JSON.stringify(log)).toContainEqual(PRETTIER_WRITE);
			expect(log, JSON.stringify(log)).toContainEqual(ESLINT_FIX);
			expect(indexOfInvocation(log, KNIP)).toBeGreaterThan(indexOfInvocation(log, PRETTIER_WRITE));
			expect(indexOfInvocation(log, KNIP)).toBeGreaterThan(indexOfInvocation(log, ESLINT_FIX));
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('runs knip once in a local full-project run', () => {
		const checkout = createCheckerClone();
		// The documented local full-project run: no arguments, no --ci, and no CI in the
		// environment. Only this case distinguishes `mode !== 'staged'` from a guard that also
		// requires `ciMode` or `mode === 'files'`.
		delete checkout.env.CI;
		try {
			const result = runChecker(checkout, []);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(knipInvocations(checkout)).toEqual([KNIP]);
			expect(cliKnipInvocations(checkout)).toEqual([CLI_KNIP]);
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 60_000);

	it('keeps knip out of the types scope', () => {
		const checkout = createCheckerClone();
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'types']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(knipInvocations(checkout)).toHaveLength(0);
			expect(cliKnipInvocations(checkout)).toHaveLength(0);
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('routes creator files only through the dedicated CLI type project', () => {
		const checkout = createCheckerClone();
		try {
			const result = runChecker(checkout, [
				'--ci',
				'--scope',
				'types',
				'packages/create-saas-starter/src/options.ts'
			]);
			const output = `${result.stdout}${result.stderr}`;
			const log = readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!);

			expect(result.status, output).toBe(0);
			expect(
				log.filter((invocation) => JSON.stringify(invocation) === JSON.stringify(CLI_TYPES))
			).toEqual([CLI_TYPES]);
			expect(log.some((invocation) => invocation.args[0] === 'svelte-check')).toBe(false);
			expect(output).toContain('create-saas-starter type checking');
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('propagates a creator typecheck failure', () => {
		const checkout = createCheckerClone();
		checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({ ...CLI_TYPES, status: 25 });
		try {
			const result = runChecker(checkout, [
				'--ci',
				'--scope',
				'types',
				'packages/create-saas-starter/tsconfig.json'
			]);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(25);
			expect(output).toContain('Command failed: bun run check:cli');
			expect(output).not.toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('dispatches compat through process.execPath without running knip', () => {
		const checkout = createCheckerClone();
		delete checkout.env.CI;
		delete checkout.env.CONVEX_COMPAT_BASE;
		try {
			replaceCompatWithRecorder(checkout);
			const result = runChecker(checkout, ['--scope', 'compat']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([
				{ command: 'compat', args: [] }
			]);
			expect(knipInvocations(checkout)).toHaveLength(0);
			expect(cliKnipInvocations(checkout)).toHaveLength(0);
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 30_000);

	it('keeps knip out of a genuinely nonempty staged lint run', () => {
		const checkout = createCheckerClone();
		try {
			stageReadme(checkout);
			const result = runChecker(checkout, ['--staged', '--scope', 'lint']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(knipInvocations(checkout)).toHaveLength(0);
			expect(cliKnipInvocations(checkout)).toHaveLength(0);
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it.each(['unset', 'unspecified'])(
		'rejects a literal %s clean driver before staged checker dispatch',
		(driver) => {
			const checkout = createCheckerClone();
			try {
				const filter = path.join(checkout.directory, 'clean-filter.ts');
				writeFileSync(
					filter,
					'process.stdout.write((await Bun.stdin.text()).replace("= 1", "= )"));\n'
				);
				runFixtureGit(checkout.repository, [
					'config',
					`filter.${driver}.clean`,
					`${shellSingleQuote(BUN.replaceAll('\\', '/'))} ${shellSingleQuote(filter.replaceAll('\\', '/'))}`
				]);
				runFixtureGit(checkout.repository, ['config', `filter.${driver}.required`, 'true']);
				writeFileSync(path.join(checkout.repository, LINTED_SOURCE), 'export const fixture = 1;\n');
				const attributes = path.join(checkout.repository, '.gitattributes');
				writeFileSync(
					attributes,
					`${readFileSync(attributes, 'utf8')}\n${LINTED_SOURCE} filter=${driver}\n`
				);
				runFixtureGit(checkout.repository, ['add', '--', '.gitattributes', LINTED_SOURCE]);
				const staged = spawnSync('git', ['show', `:${LINTED_SOURCE}`], {
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					encoding: 'utf8'
				});
				expect(staged.status, staged.stderr).toBe(0);
				expect(staged.stdout).toContain('= )');
				const indexPath = path.join(checkout.repository, '.git', 'index');
				const indexBefore = readFileSync(indexPath);

				const result = runChecker(checkout, ['--staged', '--scope', 'lint']);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).not.toBe(0);
				expect(output).toContain('Git content transformations are unsupported');
				expect(output).toContain('Disable filter, ident and working-tree-encoding');
				expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([]);
				expect(readFileSync(indexPath)).toEqual(indexBefore);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	it('checks staged content protected by a disabled filter override', () => {
		const checkout = createCheckerClone();
		try {
			const attributes = path.join(checkout.repository, '.gitattributes');
			writeFileSync(
				attributes,
				`${readFileSync(attributes, 'utf8')}\n*.ts filter=unset\n${LINTED_SOURCE} -filter\n`
			);
			writeFileSync(path.join(checkout.repository, LINTED_SOURCE), 'export const fixture = 1;\n');
			runFixtureGit(checkout.repository, ['add', '--', '.gitattributes', LINTED_SOURCE]);

			const result = runChecker(checkout, ['--staged', '--scope', 'lint']);
			const output = `${result.stdout}${result.stderr}`;
			expect(result.status, output).toBe(0);
			expect(output).toContain('All checks passed!');
			expect(
				readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!).some((command) =>
					command.args.includes(LINTED_SOURCE)
				)
			).toBe(true);
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('keeps knip out when a nonempty staged change leaves no final index inputs', () => {
		const checkout = createCheckerClone();
		const rootIndex = rootIndexSnapshot();
		try {
			stageDeletionOnly(checkout);
			const changes = spawnSync('git', ['diff', '--cached', '--name-status', '--no-renames'], {
				cwd: checkout.repository,
				env: sanitizedGitEnv(),
				encoding: 'utf8'
			});
			const inputs = spawnSync(
				'git',
				['diff', '--cached', '--name-only', '--diff-filter=d', '-z'],
				{ cwd: checkout.repository, env: sanitizedGitEnv(), encoding: 'utf8' }
			);
			expect(changes.status, changes.stderr).toBe(0);
			expect(changes.stdout).toContain('D\t');
			expect(inputs.status, inputs.stderr).toBe(0);
			expect(inputs.stdout).toBe('');

			const result = runChecker(checkout, ['--staged', '--scope', 'lint']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(knipInvocations(checkout)).toHaveLength(0);
			expect(cliKnipInvocations(checkout)).toHaveLength(0);
			expect(output).toContain('staged changes only delete paths absent from the final index');
			expect(rootIndexSnapshot()).toBe(rootIndex);
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 30_000);

	// The type checks read the whole project, so a path that left the index must still start
	// them: removing an imported module breaks its importers without leaving a file to route.
	it.each([
		['deleting an imported module', 'src/lib/billing/checkout-result.ts', undefined, APP_TYPES],
		[
			'renaming a module to a non-source name',
			'src/lib/billing/checkout-result.ts',
			'docs/checkout-result.txt',
			APP_TYPES
		],
		['deleting a Convex module', 'src/lib/convex/constants.ts', undefined, CONVEX_TYPES]
	] as const)(
		'fails a staged type run when %s breaks the project typecheck',
		(_label, source, destination, typecheck) => {
			const checkout = createCheckerClone();
			checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({ ...typecheck, status: 1 });
			try {
				stageRemoval(checkout, source, destination);
				const result = runChecker(checkout, ['--staged', '--scope', 'types']);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status, output).toBe(1);
				expect(output).toContain(`Command failed: bun ${typecheck.args.join(' ')}`);
				expect(output).not.toContain('All checks passed!');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);
});
