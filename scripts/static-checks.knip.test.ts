import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUN = testExecutable('bun');
const KNIP: CommandInvocation = { command: 'bun', args: ['knip', '--no-progress'] };
const PRETTIER_README: CommandInvocation = {
	command: 'bun',
	args: ['prettier', '--check', '--ignore-unknown', '--', 'README.md']
};
const PRETTIER_WRITE: CommandInvocation = {
	command: 'bun',
	args: ['prettier', '--write', '--ignore-unknown', '--', 'README.md', 'scripts/test-executable.ts']
};
const ESLINT_FIX: CommandInvocation = {
	command: 'bun',
	args: ['eslint', '--fix', 'scripts/test-executable.ts']
};
const RECORDER_SOURCE = path.join(
	ROOT,
	'scripts',
	'__fixtures__',
	'static-checks',
	'command-recorder.ts'
);
const WINDOWS_LIFECYCLE_WORKFLOW = path.join(
	ROOT,
	'.github',
	'workflows',
	'windows-process-lifecycle.yml'
);
const WINDOWS_LIFECYCLE_DEPENDENCIES = [
	'package.json',
	'bun.lock',
	'knowledge-policy.config.ts',
	'eslint/control-character-policy.js',
	'scripts/knowledge-policy/example.ts',
	'scripts/english-policy/example.ts',
	'src/lib/i18n/language-codes.generated.js',
	'scripts/dev-cloud.ts',
	'scripts/dev-cloud.test.ts',
	'scripts/git-context.ts',
	'scripts/static-checks.ts',
	'scripts/static-checks.test.ts',
	'scripts/static-checks.knip.test.ts',
	'scripts/terminal-output.ts',
	'scripts/test-executable.ts',
	'scripts/__fixtures__/static-checks/command-recorder.ts',
	'scripts/windows-job.ts',
	'scripts/windows-job-runner.ps1'
];
// A tracked TypeScript file that the local pre-push run passes to the mutating linters;
// with only Markdown input, the checker skips ESLint entirely.
const LINTED_SOURCE = 'scripts/test-executable.ts';
// Clone overlay pathspecs include `scripts` and the checker dependencies outside it. Without
// them, the clone would run the committed version while the worktree
// already uses a modified policy.
const OVERLAY_PATHSPECS = [
	'scripts',
	'eslint/control-character-policy.js',
	'knowledge-policy.config.ts',
	'src/lib/i18n/language-codes.generated.js'
];
// Sources required to keep a clone run from passing without seeing the change under test.
const REQUIRED_SOURCES = [
	'scripts/static-checks.ts',
	'scripts/terminal-output.ts',
	'scripts/convex-consumer-compat.ts',
	'scripts/english-policy/content.ts',
	'eslint/control-character-policy.js',
	'knowledge-policy.config.ts',
	'src/lib/i18n/language-codes.generated.js'
];
// Bun canonicalizes the checker's module path through the operating-system API, while
// `realpathSync` does not canonicalize the invocation cwd. On Windows GitHub runners,
// os.tmpdir() returns the 8.3 short name (C:\Users\RUNNER~1\...) while REPO_ROOT uses the long
// form, so every relative file argument falls outside the repository. `realpathSync.native`
// resolves through the same operating-system API and returns the same spelling for both sides.
const TEMP_ROOT = realpathSync.native(tmpdir());

interface CommandInvocation {
	command: string;
	args: string[];
}

interface CheckerClone {
	directory: string;
	repository: string;
	env: NodeJS.ProcessEnv;
}

interface CanaryOutcome {
	status: number | null;
	output: string;
	log: CommandInvocation[];
}

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

let recorderDirectory: string;
let bunVersion: string;
let canary: CanaryOutcome;

function readCommandLog(logPath: string): CommandInvocation[] {
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, 'utf8')
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as CommandInvocation);
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

function runFixtureGit(repository: string, args: string[]): void {
	const result = spawnSync('git', args, {
		cwd: repository,
		env: sanitizedGitEnv(),
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(`Fixture git ${args.join(' ')} failed: ${result.stdout}${result.stderr}`);
	}
}

function configureFixtureGitIdentity(repository: string): void {
	runFixtureGit(repository, ['config', '--local', 'user.name', 'Static Checks Fixture']);
	runFixtureGit(repository, [
		'config',
		'--local',
		'user.email',
		'static-checks-fixture@example.invalid'
	]);
}

function shellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Creates the recorders under the names the checker uses to start its child processes.
 *
 * On POSIX these are /bin/sh wrappers. With the Bun 1.3.9 pinned in package.json, a file built
 * by `bun build --compile` runs as the Bun CLI instead of its own entry point as soon as
 * argv[0] is exactly `bun`, which is precisely how the checker starts its child: recording
 * would fail and the real formatters and linters would run (measured on Linux with 1.3.9;
 * 1.3.14 no longer exhibits the effect). The wrapper instead starts the real Bun by its safely
 * quoted absolute path and passes the recorder source as one argument. Windows does not support
 * this wrapper and therefore keeps the compiled file.
 */
function createRecorderShims(directory: string, bunPath = BUN): void {
	if (process.platform === 'win32') {
		const compiledBun = path.join(directory, 'bun.exe');
		const compiled = spawnSync(
			bunPath,
			['build', RECORDER_SOURCE, '--compile', '--outfile', compiledBun],
			{ cwd: directory, env: sanitizedGitEnv(), encoding: 'utf8' }
		);
		if (compiled.status !== 0) {
			throw new Error(`Command recorder compilation failed: ${compiled.stdout}${compiled.stderr}`);
		}
		copyFileSync(compiledBun, path.join(directory, 'misspell.exe'));
		return;
	}
	for (const name of ['bun', 'misspell']) {
		const shim = path.join(directory, name);
		writeFileSync(
			shim,
			`#!/bin/sh\nSTATIC_CHECKS_COMMAND_NAME=${shellSingleQuote(name)} exec ${shellSingleQuote(bunPath)} ${shellSingleQuote(RECORDER_SOURCE)} "$@"\n`
		);
		chmodSync(shim, 0o755);
	}
}

function recorderEnv(logPath: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...sanitizedGitEnv(),
		NO_COLOR: '1',
		PATH: `${recorderDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
		STATIC_CHECKS_COMMAND_LOG: logPath
	};
	delete env.STATIC_CHECKS_COMMAND_NAME;
	return env;
}

/**
 * Overlays the clone with the worktree copies of Git-tracked sources.
 *
 * Recursively copying ROOT/scripts traverses a directory where static-checks.format.test.ts
 * concurrently creates and removes its `.format-*` fixtures. If one disappears between
 * directory enumeration and traversal, the copy aborts; in the measured case, the native
 * directory_iterator exception terminated the entire Vitest worker, silently omitting the
 * final Knip cases. The index instead provides a stable path set that never contains temporary
 * fixtures, and each file is overlaid individually. Deleted index paths are removed explicitly
 * with rename detection disabled, so a staged rename cannot leave the old HEAD path beside the
 * new file. This keeps staged sources under test without traversing or recursively deleting a
 * live directory.
 */
function overlayIndexedSources(repository: string, sourceRoot = ROOT): void {
	const deleted = spawnSync(
		'git',
		[
			'diff',
			'--cached',
			'--name-only',
			'--diff-filter=D',
			'--no-renames',
			'-z',
			'--',
			...OVERLAY_PATHSPECS
		],
		{
			cwd: sourceRoot,
			env: sanitizedGitEnv(),
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024
		}
	);
	if (deleted.status !== 0) {
		throw new Error(`Failed to list deleted indexed sources: ${deleted.stderr}`);
	}
	for (const file of deleted.stdout.split('\0').filter(Boolean)) {
		rmSync(path.join(repository, file), { force: true });
	}

	const listed = spawnSync('git', ['ls-files', '-z', '--', ...OVERLAY_PATHSPECS], {
		cwd: sourceRoot,
		env: sanitizedGitEnv(),
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024
	});
	if (listed.status !== 0) throw new Error(`Failed to list indexed sources: ${listed.stderr}`);
	const files = listed.stdout.split('\0').filter(Boolean);
	// An empty or incomplete set would let the clone run the committed state and silently skip
	// the change under test.
	if (sourceRoot === ROOT) {
		for (const required of REQUIRED_SOURCES) {
			if (!files.includes(required)) {
				throw new Error(`Git index does not contain ${required}: ${files.length} paths.`);
			}
		}
	}
	for (const file of files) {
		const source = path.join(sourceRoot, file);
		// A source tracked in the index but missing from the worktree must not silently leave the
		// committed version in the clone.
		if (!existsSync(source)) {
			throw new Error(`Indexed source is missing from the worktree: ${file}`);
		}
		mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
		copyFileSync(source, path.join(repository, file));
	}
}

function createCheckerClone(): CheckerClone {
	const directory = mkdtempSync(path.join(TEMP_ROOT, 'static-knip-'));
	const repository = path.join(directory, 'repository');
	try {
		const clone = spawnSync(
			'git',
			['clone', '--quiet', '--local', '--no-hardlinks', ROOT, repository],
			{
				env: sanitizedGitEnv(),
				encoding: 'utf8'
			}
		);
		if (clone.status !== 0) throw new Error(`Local checker clone failed: ${clone.stderr}`);
		symlinkSync(
			path.join(ROOT, 'node_modules'),
			path.join(repository, 'node_modules'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		overlayIndexedSources(repository);

		return {
			directory,
			repository,
			env: recorderEnv(path.join(directory, 'commands.jsonl'))
		};
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

function runChecker(checkout: CheckerClone, args: string[], input?: string) {
	return spawnSync(BUN, [path.join(checkout.repository, 'scripts', 'static-checks.ts'), ...args], {
		cwd: checkout.repository,
		env: checkout.env,
		encoding: 'utf8',
		input
	});
}

/** Position of an exact recording, making invocation order comparable. */
function indexOfInvocation(log: CommandInvocation[], invocation: CommandInvocation): number {
	return log.findIndex(
		(entry) =>
			entry.command === invocation.command &&
			entry.args.length === invocation.args.length &&
			entry.args.every((argument, index) => argument === invocation.args[index])
	);
}

/**
 * Counts Knip invocations in both common Bun forms.
 *
 * Measurements show that `bun knip …` and `bun run knip …` start the same package script with
 * the same arguments. Counting only the short form would hide a second invocation in the long
 * form and render the exactly-once contract ineffective. Therefore, `run` is stripped only
 * for comparison; the flags after the script name remain unchanged and are still checked
 * exactly.
 */
function knipInvocations(checkout: CheckerClone): CommandInvocation[] {
	return readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)
		.filter((invocation) => invocation.command === 'bun')
		.map((invocation) =>
			invocation.args[0] === 'run' ? { ...invocation, args: invocation.args.slice(1) } : invocation
		)
		.filter((invocation) => invocation.args[0] === 'knip');
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
	// Copying the current scripts invalidates tracked index stat data. Refresh it before the
	// checker fingerprints the index, so Git cannot rewrite those fields midway through the run.
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

/**
 * Validates the formatter canary before any matrix case runs.
 *
 * If recording does not intercept the call, the checker starts the real formatters, linters,
 * and type checks: the run is not only invalid but also takes several times longer. The canary
 * therefore belongs in the suite setup, and its failure aborts the entire file instead of
 * starting real tools again for every individual case.
 */
function runCanary(): CanaryOutcome {
	const checkout = createCheckerClone();
	checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({ ...PRETTIER_README, status: 23 });
	try {
		const result = runChecker(checkout, ['--scope', 'format', 'README.md']);
		const outcome: CanaryOutcome = {
			status: result.status,
			output: `${result.stdout}${result.stderr}`,
			log: readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)
		};
		const recorded = JSON.stringify(outcome.log);
		if (recorded !== JSON.stringify([PRETTIER_README]) || outcome.status !== 23) {
			throw new Error(
				`Recorder did not intercept the command: status ${outcome.status} instead of 23, recorded ${recorded}. ` +
					`Bun used: ${BUN} (${bunVersion}), platform ${process.platform}. ` +
					`The matrix will not run.\n${outcome.output}`
			);
		}
		return outcome;
	} finally {
		rmSync(checkout.directory, { recursive: true, force: true });
	}
}

beforeAll(() => {
	recorderDirectory = mkdtempSync(path.join(TEMP_ROOT, 'static-command-recorder-'));
	createRecorderShims(recorderDirectory);
	// Record the binary actually used: running Vitest with Bun X does not prove that
	// testExecutable('bun') resolves to the same Bun.
	bunVersion = (spawnSync(BUN, ['--version'], { encoding: 'utf8' }).stdout ?? '').trim();
	canary = runCanary();
}, 120_000);

afterAll(() => {
	rmSync(recorderDirectory, { recursive: true, force: true });
});

describe('Windows lifecycle workflow coverage', () => {
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
				label: 'ubicloud-standard-2',
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

describe.sequential('Knip static-check CLI behavior', () => {
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
		'runs knip once in %s',
		(_label, args, input) => {
			const checkout = createCheckerClone();
			try {
				const result = runChecker(checkout, [...args], input);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status, output).toBe(0);
				expect(knipInvocations(checkout)).toEqual([KNIP]);
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
			expect(output).toContain('All checks passed!');
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
			expect(output).toContain('All checks passed!');
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
			expect(output).toContain('staged changes only delete paths absent from the final index');
			expect(rootIndexSnapshot()).toBe(rootIndex);
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 30_000);

	it('returns before command dispatch when the staged index is empty', () => {
		const checkout = createCheckerClone();
		try {
			const result = runChecker(checkout, ['--staged', '--scope', 'lint']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([]);
			expect(output).toContain('No staged files to check');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 30_000);

	it('propagates a knip failure and sanitizes its output', () => {
		const checkout = createCheckerClone();
		const escape = String.fromCharCode(0x1b);
		const bell = String.fromCharCode(0x07);
		checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({
			...KNIP,
			status: 23,
			stderr: `knip${escape}]0;fixture${bell}\n`
		});
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'lint']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(23);
			expect(knipInvocations(checkout)).toEqual([KNIP]);
			expect(output).toContain('knipU+001B]0;fixtureU+0007');
			expect(output).toContain('Command failed: bun knip --no-progress');
			expect(output).not.toContain(escape);
			expect(output).not.toContain(bell);
			expect(output).not.toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);
});
