import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	APP_TYPES,
	CLI_KNIP,
	CLI_TYPES,
	CONVEX_TYPES,
	KNIP,
	TEMP_ROOT,
	cliKnipInvocations,
	indexOfInvocation,
	knipInvocations,
	knipSuite,
	readCommandLog,
	runChecker,
	stageRemoval,
	type CommandInvocation
} from './__fixtures__/static-checks/knip-harness';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRETTIER_PROJECT: CommandInvocation = {
	command: 'bun',
	args: ['prettier', '--check', '--ignore-unknown', '.']
};
const ESLINT_PROJECT: CommandInvocation = {
	command: 'bun',
	args: ['eslint', '.', '--concurrency', '2']
};
const OXLINT: CommandInvocation = { command: 'bun', args: ['oxlint'] };
/** The whole-project lint commands a GitHub Actions lint run starts right after sync. */
const PROJECT_LINTERS = [ESLINT_PROJECT, OXLINT, KNIP, CLI_KNIP];
/** Every checker clone links this repository's packages, so this is the clone's varlock. */
const INSTALLED_VARLOCK = (
	JSON.parse(readFileSync(path.join(ROOT, 'node_modules/varlock/package.json'), 'utf8')) as {
		version: string;
	}
).version;
// Default macOS and Windows volumes resolve a path regardless of letter case; most Linux ones do not.
const CASE_INSENSITIVE_TEMP = (() => {
	const probe = mkdtempSync(path.join(TEMP_ROOT, 'static-case-probe-'));
	try {
		writeFileSync(path.join(probe, 'case'), '');
		return existsSync(path.join(probe, 'CASE'));
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
})();

const suite = knipSuite();
const { createCheckerClone } = suite;

beforeAll(() => {
	suite.setUp();
}, 120_000);

afterAll(() => suite.tearDown());

describe('Knip static-check CLI behavior', { concurrent: false }, () => {
	it('reports an honest no-op for a staged deletion that no type check covers', () => {
		const checkout = createCheckerClone();
		try {
			stageRemoval(checkout, 'static/favicon.ico');
			const result = runChecker(checkout, ['--staged', '--scope', 'types']);
			const output = `${result.stdout}${result.stderr}`;
			const log = readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!);

			expect(result.status, output).toBe(0);
			expect(output).toContain(
				'NO WORK: staged changes only delete paths absent from the final index.'
			);
			expect(log).not.toContainEqual(APP_TYPES);
			expect(log).not.toContainEqual(CONVEX_TYPES);
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it.each(['a copy', 'a hard link to the destination'] as const)(
		'rejects a staged rename whose source path is still on disk as %s',
		(recreation) => {
			const checkout = createCheckerClone();
			const source = 'src/lib/billing/checkout-result.ts';
			const destination = 'docs/checkout-result.txt';
			try {
				const original = readFileSync(path.join(checkout.repository, source));
				stageRemoval(checkout, source, destination);
				if (recreation === 'a copy') {
					writeFileSync(path.join(checkout.repository, source), original);
				} else {
					linkSync(
						path.join(checkout.repository, destination),
						path.join(checkout.repository, source)
					);
				}
				const result = runChecker(checkout, ['--staged', '--scope', 'types']);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status, output).toBe(1);
				expect(output).toContain('Staged file contents differ from the worktree');
				expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([]);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	it.skipIf(!CASE_INSENSITIVE_TEMP)(
		'accepts a case-only rename whose old spelling resolves to the new file',
		() => {
			const checkout = createCheckerClone();
			const source = 'src/lib/billing/checkout-result.ts';
			try {
				stageRemoval(checkout, source, 'src/lib/billing/Checkout-result.ts');
				expect(existsSync(path.join(checkout.repository, source))).toBe(true);
				const result = runChecker(checkout, ['--staged', '--scope', 'types']);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status, output).toBe(0);
				expect(output).not.toContain('Staged file contents differ from the worktree');
				expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toContainEqual(APP_TYPES);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

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

	/**
	 * Runs a full CI lint scope whose Prettier step takes 1.5 s. The recorder logs a command
	 * when it ends, so a linter started before that step is logged before Prettier.
	 */
	function runSlowFormatterLint(githubActions: boolean) {
		const checkout = createCheckerClone();
		delete checkout.env.BUN_LINT_BINARY;
		checkout.env.GITHUB_ACTIONS = String(githubActions);
		checkout.env.STATIC_CHECKS_COMMAND_RESPONSE = JSON.stringify({
			...PRETTIER_PROJECT,
			status: 0,
			delayMs: 1_500
		});
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'lint']);
			const log = readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!);
			return {
				status: result.status,
				output: `${result.stdout}${result.stderr}`,
				order: [PRETTIER_PROJECT, ...PROJECT_LINTERS].map((invocation) =>
					indexOfInvocation(log, invocation)
				)
			};
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}

	it('starts no linter before its step in a full CI lint run outside GitHub Actions', () => {
		const { status, output, order } = runSlowFormatterLint(false);

		expect(status, output).toBe(0);
		expect(order.every((position) => position >= 0)).toBe(true);
		expect(order).toEqual(order.toSorted((left, right) => left - right));
	}, 45_000);

	// Early starts are POSIX-only, so on Windows the same run keeps every linter at its step.
	it('starts the project linters right after sync in a GitHub Actions lint run', () => {
		const { status, output, order } = runSlowFormatterLint(true);
		const [prettier, ...linters] = order;
		const headers = ['Code formatting', 'ESLint', 'oxlint', 'knip', 'create-saas-starter knip'];

		expect(status, output).toBe(0);
		if (process.platform === 'win32') {
			expect(order).toEqual(order.toSorted((left, right) => left - right));
		} else {
			expect(linters.every((position) => position >= 0 && position < prettier!)).toBe(true);
		}
		const positions = headers.map((header) => output.indexOf(`. ${header}\n`));
		expect(positions).toEqual(positions.toSorted((left, right) => left - right));
		expect(output).toContain('All checks passed!');
	}, 45_000);

	it.each([['types'], ['format']])(
		'starts no lint command in a GitHub Actions %s scope',
		(scope) => {
			const checkout = createCheckerClone();
			delete checkout.env.BUN_LINT_BINARY;
			checkout.env.GITHUB_ACTIONS = 'true';
			try {
				const result = runChecker(checkout, ['--ci', '--scope', scope]);
				const output = `${result.stdout}${result.stderr}`;
				const log = readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!);

				expect(result.status, output).toBe(0);
				expect(PROJECT_LINTERS.map((invocation) => indexOfInvocation(log, invocation))).toEqual(
					PROJECT_LINTERS.map(() => -1)
				);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

	// The prose workers run only on POSIX; Windows checks prose inline.
	it.skipIf(process.platform === 'win32')(
		'keeps a prose file error received before another prose worker fails',
		() => {
			const checkout = createCheckerClone();
			checkout.env.GITHUB_ACTIONS = 'true';
			checkout.env.PROSE_WORKER_GATE = path.join(checkout.directory, 'prose-gate');
			writeFileSync(
				path.join(checkout.repository, 'scripts', 'english-policy', 'worker.ts'),
				"import '../__fixtures__/static-checks/prose-worker-fails-after-error.ts';\n"
			);
			try {
				const result = runChecker(checkout, ['--ci', '--scope', 'lint']);
				const output = `${result.stdout}${result.stderr}`;

				expect(output).toContain('Fatal error: Transient read failure for the first prose file');
				expect(output).not.toContain('All checks passed!');
				expect(result.status, output).toBe(1);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		45_000
	);

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
			// A GitHub Actions run starts creator knip early, so only its step stays unreached.
			expect(output).not.toContain('create-saas-starter knip');
			expect(output).toContain('knipU+001B]0;fixtureU+0007');
			expect(output).toContain('Command failed: bun knip --no-progress');
			expect(output).not.toContain(escape);
			expect(output).not.toContain(bell);
			expect(output).not.toContain('All checks passed!');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('skips only creator checks for a completed generated project', () => {
		const checkout = createCheckerClone('absent');
		try {
			const result = runChecker(checkout, ['--ci']);
			const output = `${result.stdout}${result.stderr}`;
			expect(result.status, output).toBe(0);
			expect(knipInvocations(checkout)).toEqual([KNIP]);
			expect(cliKnipInvocations(checkout)).toEqual([]);
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).not.toContainEqual(CLI_TYPES);
			expect(output).toContain('cli knip         skipped — creator package removed by setup');
			expect(output).toContain('cli-types        skipped — creator package removed by setup');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	it('rejects a partially removed child before any command dispatch', () => {
		const checkout = createCheckerClone('inconsistent');
		try {
			const result = runChecker(checkout, ['--ci', '--scope', 'types']);
			expect(result.status).toBe(1);
			expect(`${result.stdout}${result.stderr}`).toContain('child package.json is missing');
			expect(readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)).toEqual([]);
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 45_000);

	// The clone links the real packages. Its lockfile is the real one with only the varlock
	// resolution replaced, so the installed version alone decides the verdict.
	function runWithLockedVarlock(locked: string) {
		const checkout = createCheckerClone();
		try {
			const lockfile = readFileSync(path.join(ROOT, 'bun.lock'), 'utf8').replace(
				/("varlock": \["varlock@)[^"]+"/,
				`$1${locked}"`
			);
			expect(lockfile).toContain(`"varlock": ["varlock@${locked}"`);
			writeFileSync(path.join(checkout.repository, 'bun.lock'), lockfile);
			const result = runChecker(checkout, ['--ci', '--scope', 'types']);
			return {
				status: result.status,
				output: `${result.stdout}${result.stderr}`,
				log: readCommandLog(checkout.env.STATIC_CHECKS_COMMAND_LOG!)
			};
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}

	it('refuses a varlock install that bun.lock does not resolve before sync', () => {
		const { status, output, log } = runWithLockedVarlock(`${INSTALLED_VARLOCK}-locked`);

		expect(status, output).toBe(1);
		expect(output).toContain(
			`node_modules has varlock ${INSTALLED_VARLOCK}, but bun.lock resolves varlock ${INSTALLED_VARLOCK}-locked.`
		);
		expect(output).toContain('bun install --frozen-lockfile');
		// The sync would have rewritten the tracked typings with the stale version.
		expect(log).toEqual([]);
	}, 45_000);

	it('runs with the varlock version bun.lock resolves', () => {
		const { status, output } = runWithLockedVarlock(INSTALLED_VARLOCK);

		expect(status, output).toBe(0);
		expect(output).toContain('All checks passed!');
	}, 45_000);
});
