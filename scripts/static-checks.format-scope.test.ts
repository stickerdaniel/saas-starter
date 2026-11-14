import { spawnSync } from 'child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import knowledgePolicy from '../knowledge-policy.config';
import {
	createPrivateCheckout,
	removePrivateCheckout,
	usePrivateCheckout
} from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';
import { runKnowledgePolicy } from './knowledge-policy/repository';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');

// Most tests here block on real Bun and Prettier processes, so Vitest checks the budget only
// after spawnSync returns; the helpers' 10 s child timeout is the hang guard. The slowest test
// without its own budget took 5.2 s on a GitHub-hosted runner and 4.4 s on Ubicloud
// (observed 2026-10-15), so the 5 s default failed a run whose assertions all passed.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Cases that write fixtures share this private checkout and remove what they write. Cases that
 * rewrite configuration, the index or history allocate their own.
 */
const checkout = usePrivateCheckout('static-checks-format-scope-');

describe('scope routing', () => {
	// Session artifacts and an interrupted fixture both leave whole trees under `scratch/`,
	// and every project-wide tool walks the repository itself. Asserting the configuration
	// files contain the string proves nothing: it stays green when the pattern moves into a
	// comment or a block that never applies. Each tool is asked instead.
	it('keeps scratch out of project-wide checks', () => {
		const directory = path.join(ROOT, 'scratch', `exclusion-${process.pid}`);
		const relative = `scratch/exclusion-${process.pid}/abandoned.test.ts`;
		const markdown = `scratch/exclusion-${process.pid}/review.md`;
		mkdirSync(directory, { recursive: true });
		const run = (args: string[]) =>
			spawnSync(testExecutable('bun'), args, {
				cwd: ROOT,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
				encoding: 'utf8'
			});
		try {
			// Invalid TypeScript, an unused binding and a test file name in one: whichever tool
			// reads it has something to say about it.
			writeFileSync(
				path.join(directory, 'abandoned.test.ts'),
				'const unused = ;\nexport function broken(: never {}\n'
			);
			writeFileSync(path.join(directory, 'review.md'), '[missing](missing.md)\n');

			const policy = runKnowledgePolicy({
				root: ROOT,
				policy: knowledgePolicy,
				scope: { kind: 'files', files: [markdown] }
			});
			expect(policy.filesEvaluated).toBe(0);
			expect(policy.findings).toEqual([]);

			const oxlint = run(['oxlint']);
			expect(`${oxlint.stdout}${oxlint.stderr}`).not.toContain('abandoned.test.ts');

			const vitest = run(['vitest', 'list', '--filesOnly']);
			expect(`${vitest.stdout}${vitest.stderr}`).not.toContain('abandoned.test.ts');

			// ESLint is asked about the file directly rather than over the project, which takes
			// minutes: naming an ignored path is how it reports the ignore rule as applied.
			const eslint = run(['eslint', relative]);
			const output = `${eslint.stdout}${eslint.stderr}`;
			expect(output).toContain('File ignored because of a matching ignore pattern');
			expect(output).not.toContain('Parsing error');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 240_000);

	it('records a numeric formatter count in an isolated full-project run', () => {
		const { repository } = checkout();
		const result = spawnSync(
			testExecutable('bun'),
			[path.join(repository, 'scripts', 'static-checks.ts'), '--ci', '--scope', 'format'],
			{
				cwd: repository,
				env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
				encoding: 'utf8'
			}
		);
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status, output).toBe(0);
		expect(output).toMatch(/prettier\s+[1-9]\d* file\(s\)/);
		expect(output).not.toContain('prettier         whole project');
	}, 120_000);

	it.skipIf(process.platform === 'win32')(
		'rejects a full lint run whose formatter matched zero files',
		() => {
			const checkout = createPrivateCheckout('static-checks-format-case-');
			const tools = path.join(checkout.directory, 'tools');
			mkdirSync(tools);
			const misspell = path.join(tools, 'misspell');
			writeFileSync(misspell, '#!/bin/sh\nexit 0\n');
			chmodSync(misspell, 0o755);
			// The invariant under test is the ledger's real in-process Prettier classification.
			// Child commands are irrelevant after that and would turn one assertion into a full
			// lint suite, so the PATH-local Bun acknowledges them without doing duplicate work.
			const childBun = path.join(tools, 'bun');
			writeFileSync(childBun, '#!/bin/sh\nexit 0\n');
			chmodSync(childBun, 0o755);
			writeFileSync(path.join(checkout.repository, '.prettierignore'), '**/*\n');
			try {
				const env = sanitizedGitEnv();
				env.NO_COLOR = '1';
				env.PATH = `${tools}${path.delimiter}${env.PATH ?? ''}`;
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts', 'static-checks.ts'),
						'--ci',
						'--scope',
						'lint'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8', timeout: 240_000 }
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('Full-project run: "prettier" matched 0 files');
				expect(output).not.toContain('prettier         whole project');
			} finally {
				removePrivateCheckout(checkout);
			}
		},
		300_000
	);

	it.skipIf(process.platform === 'win32')(
		'checks a full run with the configured Bun build and fails with it',
		() => {
			const { directory, repository } = checkout();
			// Prettier accepts this checkout, so only a run that reached the build can fail.
			const bunLint = path.join(directory, 'bun-lint');
			writeFileSync(bunLint, '#!/bin/sh\necho "bun-lint $*"\nexit 1\n');
			chmodSync(bunLint, 0o755);
			try {
				const result = spawnSync(
					testExecutable('bun'),
					[path.join(repository, 'scripts', 'static-checks.ts'), '--ci', '--scope', 'format'],
					{
						cwd: repository,
						env: { ...sanitizedGitEnv(), NO_COLOR: '1', BUN_LINT_BINARY: bunLint },
						encoding: 'utf8',
						timeout: 100_000,
						killSignal: 'SIGKILL'
					}
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toMatch(/bun-lint fmt .*--check \.$/m);
			} finally {
				rmSync(bunLint, { force: true });
			}
		},
		120_000
	);

	it.skipIf(process.platform === 'win32')(
		'rejects a staged file that no active lint check consumes',
		() => {
			const checkout = createPrivateCheckout('static-checks-format-case-');
			const tools = path.join(checkout.directory, 'staged-tools');
			mkdirSync(tools);
			for (const command of ['bun', 'misspell']) {
				const executable = path.join(tools, command);
				writeFileSync(executable, '#!/bin/sh\nexit 0\n');
				chmodSync(executable, 0o755);
			}
			const file = path.join(checkout.repository, 'src', 'i18n', 'repro.bin');
			writeFileSync(file, String.fromCharCode(1, 2, 3));
			const staged = spawnSync('git', ['add', '--', 'src/i18n/repro.bin'], {
				cwd: checkout.repository,
				env: sanitizedGitEnv(),
				encoding: 'utf8'
			});
			expect(staged.status, staged.stderr).toBe(0);
			try {
				const env = sanitizedGitEnv();
				env.NO_COLOR = '1';
				env.PATH = `${tools}${path.delimiter}${env.PATH ?? ''}`;
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts', 'static-checks.ts'),
						'--staged',
						'--scope',
						'lint'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8', timeout: 120_000 }
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('No check in the active scope (lint) is responsible');
			} finally {
				removePrivateCheckout(checkout);
			}
		},
		180_000
	);

	it.skipIf(process.platform === 'win32')(
		'accepts a deletion-only staged change after validating the final index',
		() => {
			const checkout = createPrivateCheckout('static-checks-format-case-');
			const tools = path.join(checkout.directory, 'deletion-tools');
			mkdirSync(tools);
			for (const command of ['bun', 'misspell']) {
				const executable = path.join(tools, command);
				writeFileSync(executable, '#!/bin/sh\nexit 0\n');
				chmodSync(executable, 0o755);
			}
			const relative = 'scripts/deletion-probe.md';
			writeFileSync(path.join(checkout.repository, relative), '# delete me\n');
			const git = (args: string[]) =>
				spawnSync('git', args, {
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					encoding: 'utf8'
				});
			expect(git(['add', '--', relative]).status).toBe(0);
			expect(
				git([
					'-c',
					'user.name=Probe',
					'-c',
					'user.email=probe@example.com',
					'commit',
					'--quiet',
					'--no-gpg-sign',
					'--no-verify',
					'-m',
					'Deletion fixture'
				]).status
			).toBe(0);
			expect(git(['rm', '--quiet', '--', relative]).status).toBe(0);
			try {
				const env = sanitizedGitEnv();
				env.NO_COLOR = '1';
				env.PATH = `${tools}${path.delimiter}${env.PATH ?? ''}`;
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts', 'static-checks.ts'),
						'--staged',
						'--scope',
						'lint'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8', timeout: 120_000 }
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(0);
				expect(output).toContain(
					'NO WORK: staged changes only delete paths absent from the final index.'
				);
				expect(output).toContain('All checks passed');
			} finally {
				removePrivateCheckout(checkout);
			}
		},
		180_000
	);

	it.skipIf(process.platform === 'win32')(
		'rejects an index-only deletion whose worktree configuration remains active',
		() => {
			const checkout = createPrivateCheckout('static-checks-format-case-');
			const tools = path.join(checkout.directory, 'cached-delete-tools');
			mkdirSync(tools);
			for (const command of ['bun', 'misspell']) {
				const executable = path.join(tools, command);
				writeFileSync(executable, '#!/bin/sh\nexit 0\n');
				chmodSync(executable, 0o755);
			}
			const git = (args: string[]) =>
				spawnSync('git', args, {
					cwd: checkout.repository,
					env: sanitizedGitEnv(),
					encoding: 'utf8'
				});
			expect(git(['rm', '--cached', '--quiet', '.prettierignore']).status).toBe(0);
			writeFileSync(path.join(checkout.repository, '.prettierignore'), 'static/repro.json\n');
			const repro = path.join(checkout.repository, 'static', 'repro.json');
			writeFileSync(repro, '{"value":1}\n');
			expect(git(['add', '--', 'static/repro.json']).status).toBe(0);
			try {
				const env = sanitizedGitEnv();
				env.NO_COLOR = '1';
				env.PATH = `${tools}${path.delimiter}${env.PATH ?? ''}`;
				const result = spawnSync(
					testExecutable('bun'),
					[
						path.join(checkout.repository, 'scripts', 'static-checks.ts'),
						'--staged',
						'--scope',
						'lint'
					],
					{ cwd: checkout.repository, env, encoding: 'utf8', timeout: 120_000 }
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('Staged file contents differ from the worktree');
				expect(output).not.toContain('All checks passed');
			} finally {
				removePrivateCheckout(checkout);
			}
		},
		180_000
	);

	// The staged gate ends by proving the checked bytes are still the staged bytes, and
	// that argument belongs to the lint-and-types path. A format scope leaves through its
	// own early exit, so the combination is refused rather than given a second closing.
	it('refuses a staged format run instead of exiting past the staged closing argument', () => {
		const result = spawnSync(testExecutable('bun'), [SCRIPT, '--staged', '--scope', 'format'], {
			cwd: ROOT,
			env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
			encoding: 'utf8'
		});
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status).toBe(1);
		expect(output).toContain('--scope format does not support --staged');
		// The diagnostic must not send a staged gate to `--files-from`: that names paths, and
		// every checker then reads the working tree, so a file staged unformatted and then
		// formatted only on disk would pass the gate and be committed unformatted.
		expect(output).toContain('always as the files are on disk');
		expect(output).not.toContain('use --files-from');
		expect(output).not.toContain('Code formatting');
	});

	// A locale file is Prettier's and nothing else's: no type check, no lint route. The
	// checker still has to know that, or a `--scope types` over one sees a file no check
	// covers and fails a run whose only covering check is legitimately switched off.
	it('recognizes suppressed formatter work in a type-scoped run over a locale file', () => {
		const result = spawnSync(
			testExecutable('bun'),
			[SCRIPT, '--ci', '--scope', 'types', 'src/i18n/en.json'],
			{ cwd: ROOT, env: { ...sanitizedGitEnv(), NO_COLOR: '1' }, encoding: 'utf8' }
		);
		const output = `${result.stdout}${result.stderr}`;
		expect(output).toContain('every check covering them is switched off');
		expect(output).not.toContain('no check ran over any of them');
		expect(result.status).toBe(0);
	}, 120_000);
});
