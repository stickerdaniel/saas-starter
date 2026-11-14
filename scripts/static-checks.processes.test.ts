import { spawn, spawnSync } from 'child_process';
import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'os';
import path from 'path';
import { Writable } from 'stream';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
	CHECKER_SPAWN_TIMEOUT,
	checkoutEvaluator
} from './__fixtures__/static-checks/checker-harness';
import { readPid } from './__fixtures__/static-checks/pid-file';
import { usePrivateCheckout } from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';
import {
	existingRepositoryPaths,
	formatPathForDiagnostic,
	prettierFormattableFiles,
	prettierProjectPaths,
	prettierTraversalPaths,
	startCommand,
	unsafePathCodepoints
} from './static-checks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

const FIXTURES = path.join(ROOT, 'scripts', '__fixtures__', 'static-checks');
const BUN = testExecutable('bun');

/** Exit code only. Every case here fails at intake, so no check subprocess runs. */
function run(...args: string[]): number {
	return spawnSync('bun', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' }).status ?? -1;
}

/** Cases that write fixtures share this private checkout and remove what they write. */
const checkout = usePrivateCheckout('static-checks-processes-');
const evaluateInCheckout = checkoutEvaluator(checkout);

describe('repository path safety', { timeout: CHECKER_SPAWN_TIMEOUT }, () => {
	it('keeps missing tracked files out of full-mode content readers', () => {
		expect(existingRepositoryPaths(['README.md', 'docs/does-not-exist.md'])).toEqual(['README.md']);
	});

	it('counts formattable files and drops an ignored declaration', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'static-checks-format-count-'));
		try {
			mkdirSync(path.join(directory, 'src'), { recursive: true });
			mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
			writeFileSync(path.join(directory, '.prettierignore'), 'src/varlock-env.d.ts\n');
			writeFileSync(path.join(directory, 'src/kept.ts'), 'export const value = 1;\n');
			writeFileSync(path.join(directory, 'src/varlock-env.d.ts'), 'export {};\n');
			writeFileSync(path.join(directory, 'node_modules/ignored.ts'), 'export const hidden = 1;\n');

			const traversed = prettierTraversalPaths(directory, false, directory);
			const formattable = await prettierFormattableFiles(
				prettierProjectPaths(traversed, directory),
				directory
			);

			expect(formattable).toContain('src/kept.ts');
			expect(formattable).not.toContain('src/varlock-env.d.ts');
			expect(traversed).toContain('src/varlock-env.d.ts');
			expect(traversed.join('\n')).not.toContain('node_modules/');
			expect(formattable.length).toBeGreaterThan(0);
			expect(formattable.length).toBeLessThan(traversed.length);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('includes untracked nonignored files in the full-mode preflight', () => {
		const relative = `src/lib/content/.static-checks-untracked-${process.pid}.md`;
		const file = path.join(checkout().repository, relative);
		writeFileSync(file, 'safe');
		try {
			expect(evaluateInCheckout('checks.repositoryPaths()')).toContain(relative);
		} finally {
			rmSync(file, { force: true });
		}
	});

	it('counts files Prettier visits even when local Git configuration ignores them', () => {
		const { repository } = checkout();
		const directory = mkdtempSync(path.join(tmpdir(), 'static-checks-local-ignore-'));
		const excludes = path.join(directory, 'excludes');
		const relative = `.static-checks-local-ignore-${process.pid}.json`;
		const file = path.join(repository, relative);
		writeFileSync(excludes, `${relative}\n`);
		writeFileSync(file, '{"safe": true}\n');
		const env = {
			...sanitizedGitEnv(),
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.excludesFile',
			GIT_CONFIG_VALUE_0: excludes
		};
		try {
			// All three run under the same local excludes: the formatter helpers must still see
			// the file Git ignores.
			expect(evaluateInCheckout('checks.repositoryPaths()', [], env)).not.toContain(relative);
			expect(evaluateInCheckout('checks.prettierTraversalPaths()', [], env)).toContain(relative);
			expect(
				evaluateInCheckout('checks.prettierFormattableFiles([values[0]])', [relative], env)
			).toEqual([relative]);
		} finally {
			rmSync(file, { force: true });
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'skips session artifacts and Sapling metadata without guessing file-level ignores',
		async () => {
			const fixture = mkdtempSync(path.join(tmpdir(), 'prettier-traversal-'));
			mkdirSync(path.join(fixture, 'scratch'));
			mkdirSync(path.join(fixture, '.sl'));
			mkdirSync(path.join(fixture, 'src', '__fixtures__'), { recursive: true });
			writeFileSync(path.join(fixture, '.gitignore'), '');
			writeFileSync(path.join(fixture, '.prettierignore'), '/scratch/\n**/__fixtures__/*.ts\n');
			writeFileSync(path.join(fixture, 'scratch', 'bad\n.ts'), 'unsafe');
			writeFileSync(path.join(fixture, '.sl', 'probe.ts'), 'metadata');
			writeFileSync(path.join(fixture, 'src', 'good.ts'), 'source');
			writeFileSync(path.join(fixture, 'src', '__fixtures__', 'README.md'), 'markdown');
			try {
				const files = await prettierTraversalPaths(fixture, true);
				expect(files).toContain('src/good.ts');
				expect(files).toContain('src/__fixtures__/README.md');
				expect(files).not.toContain('scratch/bad\n.ts');
				expect(files).not.toContain('.sl/probe.ts');
			} finally {
				rmSync(fixture, { recursive: true, force: true });
			}
		}
	);

	it.skipIf(process.platform === 'win32')(
		'keeps symlinks out of the project formatter ledger',
		() => {
			const { repository } = checkout();
			const relative = `.static-checks-prettier-link-${process.pid}.md`;
			const file = path.join(repository, relative);
			symlinkSync(path.join(repository, 'README.md'), file);
			try {
				expect(evaluateInCheckout('checks.repositoryPaths()')).toContain(relative);
				// The formatter scope keeps the link's own name, because Prettier neither follows
				// nor accepts one, and the project ledger is what drops it.
				expect(
					evaluateInCheckout(
						"checks.resolveInputs([values[0]], 'test', process.cwd(), checks.repositoryPaths, false)",
						[file]
					)
				).toEqual([relative]);
				expect(prettierProjectPaths([relative], repository)).toEqual([]);
				// Every other scope routes by extension, so it needs the target instead: under the
				// link's own `.md` name a TypeScript target reaches no checker and the run passes
				// having checked nothing.
				expect(evaluateInCheckout("checks.resolveInputs([values[0]], 'test')", [file])).toEqual([
					'README.md'
				]);
			} finally {
				rmSync(file, { force: true });
			}
		}
	);

	it('encodes unsafe path characters in diagnostics', () => {
		expect(formatPathForDiagnostic(`bad${String.fromCharCode(0x1b)}.txt`)).toBe(
			'"bad\\\\u001B.txt"'
		);
	});

	it('rejects a malicious filename before subprocesses run without printing its payload', () => {
		const { repository } = checkout();
		const directory = path.join(repository, 'scratch', 'static-checks-path-test');
		mkdirSync(directory, { recursive: true });
		const offender = `${String.fromCharCode(0x1b)}]0;OWNED${String.fromCharCode(0x07)}`;
		const file = path.join(directory, `bad${offender}.txt`);
		writeFileSync(file, 'safe');
		try {
			const result = spawnSync('bun', [path.join(repository, 'scripts/static-checks.ts'), file], {
				cwd: repository,
				encoding: 'utf8',
				env: sanitizedGitEnv()
			});
			const output = `${result.stdout}${result.stderr}`;
			expect(result.status).toBe(1);
			expect(output).toContain('U+001B');
			expect(output).not.toContain(offender);
			expect(output).not.toContain(String.fromCharCode(0x07));
			expect(output).not.toContain('SvelteKit sync');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === 'win32')(
		'rejects an unsafe symlink name before resolving its target',
		() => {
			const { repository } = checkout();
			const directory = path.join(repository, 'scratch', 'static-checks-symlink-test');
			mkdirSync(directory, { recursive: true });
			const offender = String.fromCharCode(0x202e);
			const file = path.join(directory, `unsafe${offender}.md`);
			symlinkSync(path.join(repository, 'README.md'), file);
			try {
				const script = path.join(repository, 'scripts/static-checks.ts');
				const result = spawnSync('bun', [script, file], {
					cwd: repository,
					encoding: 'utf8',
					env: sanitizedGitEnv()
				});
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status).toBe(1);
				expect(output).toContain('U+202E');
				expect(output).not.toContain(offender);
				expect(output).not.toContain('SvelteKit sync');
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it('identifies structural, invisible, line-separator, and bidirectional controls in paths', () => {
		for (const code of [0x09, 0x0a, 0x0d, 0x7f, 0x85, 0x2028, 0x2029, 0x202e, 0xfeff, 0xfffd]) {
			expect(unsafePathCodepoints(`bad${String.fromCharCode(code)}.txt`)).toHaveLength(1);
		}
	});
});

describe('bad input dies at the boundary', { timeout: CHECKER_SPAWN_TIMEOUT }, () => {
	it('omits parent-owned ANSI when NO_COLOR is set', () => {
		const result = spawnSync('bun', [SCRIPT, '--unknown'], {
			cwd: ROOT,
			encoding: 'utf8',
			env: { ...sanitizedGitEnv(), NO_COLOR: '1' }
		});
		expect(result.status).toBe(1);
		expect(`${result.stdout}${result.stderr}`).not.toContain('\x1b');
	});

	it.each([
		['an empty argument', ['']],
		['a newline-joined list arriving as one argument', ['src/a.ts\nsrc/b.ts']],
		['a path that does not exist', ['src/does-not-exist.ts']],
		['a path outside the repository', ['/etc/hosts']],
		['an unknown flag', ['--CI', '--scope', 'lint']],
		['a misspelled flag whose value would leak into the file list', ['--scop', 'lint']]
	])('rejects %s', (_label, args) => {
		expect(run(...args)).toBe(1);
	});

	// A staged run with a clean index is an honest no-op. Skip this local assertion
	// while a developer has real staged files, since it would run the complete gate.
	const nothingStaged =
		spawnSync('git', ['diff', '--cached', '--quiet'], {
			cwd: ROOT,
			env: sanitizedGitEnv()
		}).status === 0;
	it.skipIf(!nothingStaged)('still accepts a run with nothing staged', () => {
		expect(run('--staged', '--scope', 'lint')).toBe(0);
	});
});

describe('commands started before their step', { timeout: CHECKER_SPAWN_TIMEOUT }, () => {
	const DRIVER = path.join(FIXTURES, 'started-command.ts');

	/** Runs a driver case with stdout and stderr written to one file, in write order. */
	function drive(
		scenario: string,
		githubActions = false,
		env: Record<string, string> = {}
	): { status: number; output: string } {
		const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
		const outputPath = path.join(directory, 'output');
		const output = openSync(outputPath, 'w');
		try {
			const result = spawnSync(BUN, [DRIVER, scenario, directory], {
				cwd: ROOT,
				env: {
					...sanitizedGitEnv(),
					NO_COLOR: '1',
					GITHUB_ACTIONS: String(githubActions),
					...env
				},
				stdio: ['ignore', output, output],
				timeout: 20_000
			});
			return { status: result.status ?? -1, output: readFileSync(outputPath, 'utf8') };
		} finally {
			closeSync(output);
			rmSync(directory, { recursive: true, force: true });
		}
	}

	it('holds both streams until finish and keeps each stream in order', () => {
		const { status, output } = drive('interleaved');
		const lines = output.trim().split('\n');

		expect(lines[0]).toBe('before-finish');
		expect(lines.at(-1)).toBe('after-finish');
		expect(lines.filter((line) => line.startsWith('out-'))).toEqual(['out-1', 'out-2']);
		expect(lines.toSorted()).toEqual(['after-finish', 'before-finish', 'err-1', 'out-1', 'out-2']);
		expect(status).toBe(0);
	});

	it('shows what a still-running command printed as soon as its step starts', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
		try {
			const child = spawn(BUN, [DRIVER, 'gated', directory], {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1', GITHUB_ACTIONS: 'false' },
				stdio: ['ignore', 'pipe', 'inherit']
			});
			let output = '';
			child.stdout.on('data', (chunk: Buffer) => {
				output += chunk.toString();
				// The command waits for this file, so it can only finish once its prefix is out.
				if (output.includes('prefix\n')) writeFileSync(path.join(directory, 'gate'), '');
			});
			const status = await new Promise<number | null>((resolve) => child.on('close', resolve));

			expect(output).toBe('finishing\nprefix\nsuffix\nfinished\n');
			expect(status).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.each([
		['fails', 'failure', 3, 'diagnostic\nCommand failed: '],
		['cannot start', 'missing', 1, 'Command could not start: missing-static-checks-command\n']
	])(
		'reports a command that %s at finish, the way a sequential run does',
		(_label, scenario, status, report) => {
			const started = drive(`started-${scenario}`);

			expect(started.output).toContain(`before-finish\n${report}`);
			expect(started.status).toBe(status);
			expect(started).toEqual(drive(`run-${scenario}`));
		}
	);

	async function waitFor(ready: () => boolean): Promise<void> {
		const deadline = Date.now() + 10_000;
		while (!ready()) {
			if (Date.now() > deadline) throw new Error('Timed out');
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	it('finishes only after the destination accepted the held output', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
		const exited = path.join(directory, 'exited');
		const callbacks: Array<() => void> = [];
		let accepting = false;
		let text = '';
		const destination = new Writable({
			write(chunk: Buffer, _encoding, callback) {
				text += chunk.toString();
				if (accepting) callback();
				else callbacks.push(callback);
			}
		});
		try {
			const command = startCommand(
				process.execPath,
				[
					'-e',
					"process.stdout.write('output\\n'); require('fs').writeFileSync(process.argv[1], '')",
					exited
				],
				{ stdout: destination, stderr: destination, githubActions: false }
			);
			await waitFor(() => existsSync(exited));
			const finished = command.finish().then(() => 'finished');
			const early = await Promise.race([
				finished,
				new Promise((resolve) => setTimeout(() => resolve('waiting'), 500))
			]);
			accepting = true;
			for (const callback of callbacks) callback();

			expect(early).toBe('waiting');
			expect(await finished).toBe('finished');
			expect(text).toBe('output\n');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('keeps output that arrives while held output is written, then passes output through', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
		const marker = (name: string) => path.join(directory, name);
		// Each line waits for the test's marker file before it is written.
		const script = `
			const { existsSync, writeFileSync } = require('fs');
			const directory = process.argv[1];
			const after = (name, next) => {
				const deadline = Date.now() + 10000;
				const timer = setInterval(() => {
					if (existsSync(directory + '/' + name)) {
						clearInterval(timer);
						next();
					} else if (Date.now() > deadline) process.exit(9);
				}, 10);
			};
			process.stdout.write('prefix\\n');
			writeFileSync(directory + '/printed', '');
			after('intervene', () => {
				process.stdout.write('intervening\\n');
				writeFileSync(directory + '/intervened', '');
				after('live', () => process.stdout.write('suffix\\n'));
			});
		`;
		let acceptFirst = (): void => {};
		const firstAccepted = new Promise<void>((resolve) => (acceptFirst = resolve));
		const chunks: string[] = [];
		const destination = new Writable({
			write(chunk: Buffer, _encoding, callback) {
				chunks.push(chunk.toString());
				if (chunks.length === 1) void firstAccepted.then(() => callback());
				else callback();
			}
		});
		try {
			const command = startCommand(process.execPath, ['-e', script, directory], {
				stdout: destination,
				stderr: destination,
				githubActions: true
			});
			await waitFor(() => existsSync(marker('printed')));
			const finished = command.finish();
			// The stop marker is now written but unaccepted. The next line arrives meanwhile; the
			// pause lets it reach the held queue, though the order holds either way.
			writeFileSync(marker('intervene'), '');
			await waitFor(() => existsSync(marker('intervened')));
			await new Promise((resolve) => setTimeout(resolve, 100));
			acceptFirst();
			await waitFor(() => chunks.join('').includes('intervening\n'));
			writeFileSync(marker('live'), '');
			await finished;

			const token = chunks.join('').match(/^::stop-commands::(.+)$/m)?.[1];
			expect(chunks.join('')).toBe(
				`\n::stop-commands::${token}\nprefix\nintervening\nsuffix\n\n::${token}::\n`
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('replays the GitHub workflow-command markers once, around the output', () => {
		const { status, output } = drive('started-failure', true);
		const token = output.match(/^::stop-commands::(.+)$/m)?.[1];

		expect(token).toBeDefined();
		expect(output.split(`::stop-commands::${token}`)).toHaveLength(2);
		expect(output.split(`::${token}::`)).toHaveLength(2);
		expect(output.indexOf('before-finish')).toBeLessThan(output.indexOf('::stop-commands::'));
		expect(output.indexOf('diagnostic')).toBeGreaterThan(output.indexOf('::stop-commands::'));
		expect(output.indexOf(`::${token}::`)).toBeGreaterThan(output.indexOf('diagnostic'));
		expect(status).toBe(3);
	});

	it.each([
		['SOURCE-1', false],
		['SOURCE-1', true],
		['::stop-commands::', true]
	])(
		'handles a destination that refuses %s like an unheld run (GitHub Actions: %s)',
		(refuse, githubActions) => {
			const normalize = (output: string) =>
				output.replaceAll(/terminal-output-[0-9a-f-]+/g, 'TOKEN');
			const started = drive('destination-error-started', githubActions, { REFUSE: refuse });
			const run = drive('destination-error-run', githubActions, { REFUSE: refuse });

			expect(normalize(started.output)).toBe(normalize(run.output));
			expect(started.output.includes('OTHER-SOURCE')).toBe(refuse === 'SOURCE-1');
			expect(started.output).not.toContain('SOURCE-2');
			expect(started.status).toBe(1);
			expect(run.status).toBe(1);
		}
	);

	it('takes a PID file as ready only once it holds a positive PID', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'pid-file-'));
		try {
			const file = path.join(directory, 'pid');
			const states = ['', '0\n', '42'].map((text) => {
				writeFileSync(file, text);
				return readPid(file);
			});
			writeFileSync(file, '4242\n');

			expect(readPid(path.join(directory, 'missing'))).toBeUndefined();
			expect(states).toEqual([undefined, undefined, undefined]);
			expect(readPid(file)).toBe(4242);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	/** Alive and not a zombie that its new parent has yet to reap. */
	function running(pid: number): boolean {
		const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
		return state.stdout.trim() !== '' && !state.stdout.trim().startsWith('Z');
	}

	it.skipIf(process.platform === 'win32')(
		'kills every descendant of a started command when an earlier check exits',
		async () => {
			const directory = mkdtempSync(path.join(tmpdir(), 'started-command-'));
			const pids: number[] = [];
			try {
				const result = spawnSync(BUN, [DRIVER, 'early-exit', directory], {
					cwd: ROOT,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1', GITHUB_ACTIONS: 'false' },
					encoding: 'utf8',
					timeout: 20_000
				});
				expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
				// One grandchild ignores SIGTERM beside its live leader; the other outlived its leader.
				for (const name of ['stubborn', 'orphaned']) {
					// Never a malformed one: `Number('')` is 0, and SIGKILL to 0 hits this process group.
					const pid = readPid(path.join(directory, name));
					if (pid === undefined) throw new Error(`The driver exited before ${name} held a PID`);
					pids.push(pid);
				}
				const deadline = Date.now() + 5_000;
				while (pids.some(running) && Date.now() < deadline) {
					await new Promise((resolve) => setTimeout(resolve, 20));
				}

				expect(pids.filter(running)).toEqual([]);
			} finally {
				for (const pid of pids) {
					try {
						process.kill(pid, 'SIGKILL');
					} catch {
						// Already gone.
					}
				}
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);
});
