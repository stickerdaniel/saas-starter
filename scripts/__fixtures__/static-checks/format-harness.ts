import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizedGitEnv } from '../../git-context';
import { testExecutable } from '../../test-executable';
import type { PrivateCheckout } from './private-checkout';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The checker derives its root from its module path, so isolate both script and cwd. */
export function formatChecks(repository = ROOT) {
	const script = path.join(repository, 'scripts', 'static-checks.ts');
	return {
		formatCheck(...args: string[]): { status: number; output: string } {
			const result = spawnSync(
				testExecutable('bun'),
				[script, '--ci', '--scope', 'format', ...args],
				{
					cwd: repository,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					timeout: 10_000,
					killSignal: 'SIGKILL',
					encoding: 'utf8'
				}
			);
			return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
		},

		/** The computed-list channel used by format-only hook consumers. */
		formatCheckFilesFrom(
			input: string | Uint8Array,
			cwd = repository
		): { status: number; output: string } {
			const result = spawnSync(
				testExecutable('bun'),
				[script, '--ci', '--scope', 'format', '--files-from', '-'],
				{
					cwd,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					timeout: 10_000,
					killSignal: 'SIGKILL',
					input,
					encoding: 'utf8'
				}
			);
			return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
		}
	};
}

/**
 * `withRepositoryFile` bound to a test file's private checkout. `checkout` is read on each
 * call, so the binding can be made at module level, before the checkout exists.
 */
export function repositoryFileWriter(checkout: () => PrivateCheckout) {
	/** Write an unformatted file into the private checkout for one assertion. */
	return function withRepositoryFile(
		name: string,
		contents: string,
		assertion: (file: string) => void
	): void {
		const file = path.join(checkout().repository, name);
		writeFileSync(file, contents);
		try {
			assertion(file);
		} finally {
			rmSync(file, { force: true });
		}
	};
}
