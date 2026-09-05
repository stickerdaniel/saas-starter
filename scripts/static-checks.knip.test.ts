import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
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
const RECORDER_SOURCE = path.join(
	ROOT,
	'scripts',
	'__fixtures__',
	'static-checks',
	'command-recorder.ts'
);
// Bun kanonisiert den Modulpfad des Checkers über die Betriebssystem-API, `realpathSync` die
// Aufruf-cwd dagegen nicht. Unter Windows liefert os.tmpdir() auf GitHub-Runnern den
// 8.3-Kurznamen (C:\Users\RUNNER~1\...), während REPO_ROOT die Langform trägt; jedes relative
// Dateiargument fällt damit aus dem Repository. `realpathSync.native` löst über dieselbe
// Betriebssystem-API auf und liefert für beide Seiten dieselbe Schreibweise.
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
 * Legt die Recorder unter den Namen an, unter denen der Checker seine Kinder startet.
 *
 * Unter POSIX sind das Shebang-Skripte. Eine mit `bun build --compile` erzeugte Datei läuft
 * auf dem in package.json gepinnten Bun 1.3.9 als Bun-CLI statt als eigener Einsprungpunkt,
 * sobald argv[0] exakt `bun` lautet, und genau so startet der Checker sein Kind: die
 * Aufzeichnung fiele aus und echte Formatter und Linter liefen los (gemessen unter Linux mit
 * 1.3.9; 1.3.14 zeigt den Effekt nicht mehr). Ein Shebang-Skript wird stattdessen vom echten
 * Bun mit absolutem argv[0] gestartet und behält seinen Einsprungpunkt. Windows kennt kein
 * Shebang und behält deshalb die kompilierte Datei.
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
		cpSync(path.join(ROOT, 'scripts'), path.join(repository, 'scripts'), {
			recursive: true,
			dereference: true
		});

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

/**
 * Nimmt den Formatter-Canary ab, bevor irgendein Matrixfall läuft.
 *
 * Greift die Aufzeichnung nicht, dann startet der Checker die echten Formatter, Linter und
 * Typprüfungen: der Lauf ist nicht nur falsch, sondern dauert ein Vielfaches. Der Canary
 * gehört deshalb ins Suite-Setup, und sein Fehler bricht die ganze Datei ab, statt in jedem
 * Einzelfall erneut echte Werkzeuge zu starten.
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
				`Der Recorder greift nicht: Status ${outcome.status} statt 23, aufgezeichnet ${recorded}. ` +
					`Verwendetes Bun: ${BUN} (${bunVersion}), Plattform ${process.platform}. ` +
					`Die Matrix wird nicht ausgeführt.\n${outcome.output}`
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
	// Das tatsächlich verwendete Binary festhalten: ein mit Bun X gestartetes Vitest belegt
	// nicht, dass testExecutable('bun') dasselbe Bun auflöst.
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
		// Der dokumentierte Pre-Push-Aufruf ist `static-checks.ts <geänderte Dateien>`: ohne
		// --ci und ohne CI in der Umgebung. Erst dieser Fall unterscheidet die tatsächliche
		// Bedingung `mode !== 'staged'` von einem reinen CI-Gate.
		delete checkout.env.CI;
		try {
			const result = runChecker(checkout, ['README.md']);
			const output = `${result.stdout}${result.stderr}`;

			expect(result.status, output).toBe(0);
			expect(knipInvocations(checkout)).toEqual([KNIP]);
			// Der zweite über PATH aufgelöste Name: misspell wird nur hier tatsächlich
			// abgesetzt und belegt, dass die Auflösung nicht bloß für bun greift.
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toContainEqual({
				command: 'misspell',
				args: ['-error', 'README.md']
			});
			expect(output).toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

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
