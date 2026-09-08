import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
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
// A tracked TypeScript file that the local pre-push run passes to the mutating linters;
// with only Markdown input, the checker skips ESLint entirely.
const LINTED_SOURCE = 'scripts/test-executable.ts';
// Clone overlay pathspecs: `scripts` plus the two files outside it that the checker imports
// directly. Without them, the clone would run the committed version while the worktree
// already uses a modified policy.
const OVERLAY_PATHSPECS = [
	'scripts',
	'eslint/control-character-policy.js',
	'knowledge-policy.config.ts'
];
// Sources required to keep a clone run from passing without seeing the change under test.
const REQUIRED_SOURCES = [
	'scripts/static-checks.ts',
	'scripts/terminal-output.ts',
	'scripts/convex-consumer-compat.ts',
	'eslint/control-character-policy.js',
	'knowledge-policy.config.ts'
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

/**
 * Creates the recorders under the names the checker uses to start its child processes.
 *
 * On POSIX these are shebang scripts. With the Bun 1.3.9 pinned in package.json, a file built
 * by `bun build --compile` runs as the Bun CLI instead of its own entry point as soon as
 * argv[0] is exactly `bun`, which is precisely how the checker starts its child: recording
 * would fail and the real formatters and linters would run (measured on Linux with 1.3.9;
 * 1.3.14 no longer exhibits the effect). A shebang script is instead started by the real Bun
 * with an absolute argv[0] and retains its entry point. Windows does not support shebangs and
 * therefore keeps the compiled file.
 */
function createRecorderShims(directory: string): void {
	if (process.platform === 'win32') {
		const compiledBun = path.join(directory, 'bun.exe');
		const compiled = spawnSync(
			BUN,
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
		writeFileSync(shim, `#!${BUN}\nimport ${JSON.stringify(RECORDER_SOURCE)};\n`);
		chmodSync(shim, 0o755);
	}
}

function recorderEnv(logPath: string): NodeJS.ProcessEnv {
	return {
		...sanitizedGitEnv(),
		NO_COLOR: '1',
		PATH: `${recorderDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
		STATIC_CHECKS_COMMAND_LOG: logPath
	};
}

/**
 * Overlays the clone with the worktree copies of Git-tracked sources.
 *
 * Recursively copying ROOT/scripts traverses a directory where static-checks.format.test.ts
 * concurrently creates and removes its `.format-*` fixtures. If one disappears between
 * directory enumeration and traversal, the copy aborts; in the measured case, the native
 * directory_iterator exception terminated the entire Vitest worker, silently omitting the
 * final Knip cases. The index instead provides a stable path set that never contains temporary
 * fixtures, and each file is overlaid individually. This keeps changes to tracked and already
 * staged sources under test before the commit without traversing a live directory.
 */
function overlayIndexedSources(repository: string): void {
	const listed = spawnSync('git', ['ls-files', '-z', '--', ...OVERLAY_PATHSPECS], {
		cwd: ROOT,
		env: sanitizedGitEnv(),
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024
	});
	if (listed.status !== 0) throw new Error(`Failed to list indexed sources: ${listed.stderr}`);
	const files = listed.stdout.split('\0').filter(Boolean);
	// An empty or incomplete set would let the clone run the committed state and silently skip
	// the change under test.
	for (const required of REQUIRED_SOURCES) {
		if (!files.includes(required)) {
			throw new Error(`Git index does not contain ${required}: ${files.length} paths.`);
		}
	}
	for (const file of files) {
		const source = path.join(ROOT, file);
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

			// Outside --ci, Prettier (--write) and ESLint (--fix) write to the worktree. Knip reads
			// the dependency graph and must therefore run after the mutating child processes, or it
			// would evaluate a state that the run subsequently changes. Read-only checks may follow,
			// so there is no contract that Knip is the final step.
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
