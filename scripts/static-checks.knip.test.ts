import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
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
const RECORDER_SOURCE = path.join(
	ROOT,
	'scripts',
	'__fixtures__',
	'static-checks',
	'command-recorder.ts'
);

interface CommandInvocation {
	command: string;
	args: string[];
}

interface CheckerClone {
	directory: string;
	repository: string;
	env: NodeJS.ProcessEnv;
}

let recorderDirectory: string;
let recorderBun: string;
let recorderMisspell: string;

function readCommandLog(logPath: string): CommandInvocation[] {
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, 'utf8')
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as CommandInvocation);
}

function createCheckerClone(): CheckerClone {
	const directory = mkdtempSync(path.join(tmpdir(), 'static-knip-'));
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
		cpSync(path.join(ROOT, 'scripts'), path.join(repository, 'scripts'), {
			recursive: true,
			dereference: true
		});

		const logPath = path.join(directory, 'commands.jsonl');
		return {
			directory,
			repository,
			env: {
				...sanitizedGitEnv(),
				NO_COLOR: '1',
				PATH: `${recorderDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
				STATIC_CHECKS_COMMAND_LOG: logPath
			}
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

function knipInvocations(checkout: CheckerClone): CommandInvocation[] {
	return readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!).filter(
		(invocation) => invocation.command === 'bun' && invocation.args[0] === 'knip'
	);
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

beforeAll(() => {
	recorderDirectory = mkdtempSync(path.join(tmpdir(), 'static-command-recorder-'));
	recorderBun = path.join(recorderDirectory, process.platform === 'win32' ? 'bun.exe' : 'bun');
	recorderMisspell = path.join(
		recorderDirectory,
		process.platform === 'win32' ? 'misspell.exe' : 'misspell'
	);
	const compiled = spawnSync(
		BUN,
		['build', RECORDER_SOURCE, '--compile', '--outfile', recorderBun],
		{ cwd: recorderDirectory, env: sanitizedGitEnv(), encoding: 'utf8' }
	);
	if (compiled.status !== 0) {
		throw new Error(`Command recorder compilation failed: ${compiled.stdout}${compiled.stderr}`);
	}
	copyFileSync(recorderBun, recorderMisspell);
	if (process.platform !== 'win32') {
		chmodSync(recorderBun, 0o755);
		chmodSync(recorderMisspell, 0o755);
	}
});

afterAll(() => {
	rmSync(recorderDirectory, { recursive: true, force: true });
});

describe.sequential('Knip static-check CLI behavior', () => {
	it('pins compiled recorder argv and executable identity', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'static-recorder-contract-'));
		const logPath = path.join(directory, 'commands.jsonl');
		const env = { ...sanitizedGitEnv(), STATIC_CHECKS_COMMAND_LOG: logPath };
		try {
			const bun = spawnSync(recorderBun, ['prettier', '--check', 'README.md'], {
				env,
				encoding: 'utf8'
			});
			const misspell = spawnSync(recorderMisspell, ['-error', 'README.md'], {
				env,
				encoding: 'utf8'
			});

			expect(bun.status, `${bun.stdout}${bun.stderr}`).toBe(0);
			expect(misspell.status, `${misspell.stdout}${misspell.stderr}`).toBe(0);
			expect(readCommandLog(logPath)).toEqual([
				{ command: 'bun', args: ['prettier', '--check', 'README.md'] },
				{ command: 'misspell', args: ['-error', 'README.md'] }
			]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it('propagates a recorded formatter failure through the real CLI boundary', () => {
		const checkout = createCheckerClone();
		const prettier = {
			command: 'bun',
			args: ['prettier', '--check', '--ignore-unknown', '--', 'README.md']
		};
		checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({ ...prettier, status: 23 });
		try {
			const result = runChecker(checkout, ['--scope', 'format', 'README.md']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(23);
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([prettier]);
			expect(knipInvocations(checkout)).toHaveLength(0);
			expect(output).toContain(
				'Command failed: bun prettier --check --ignore-unknown -- README.md'
			);
			expect(output).not.toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 30_000);

	it('keeps knip out of a successful format scope', () => {
		const checkout = createCheckerClone();
		const prettier = {
			command: 'bun',
			args: ['prettier', '--check', '--ignore-unknown', '--', 'README.md']
		};
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'format', 'README.md']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([prettier]);
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
