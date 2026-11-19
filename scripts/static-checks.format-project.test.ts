import { spawnSync } from 'child_process';
import { rmSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createCheckerTree } from './__fixtures__/static-checks/compat-harness';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';

// A full-project format run checks every regular file of its tree and skips symlinks. The
// checker tree copies only `scripts/` and links the rest, so the run formats about 200 files
// instead of the whole repository.
describe('scope routing', () => {
	it('records a numeric formatter count in an isolated full-project run', () => {
		const checkout = createCheckerTree();
		try {
			const result = spawnSync(
				testExecutable('bun'),
				[
					path.join(checkout.repository, 'scripts', 'static-checks.ts'),
					'--ci',
					'--scope',
					'format'
				],
				{
					cwd: checkout.repository,
					env: { ...sanitizedGitEnv(), NO_COLOR: '1' },
					encoding: 'utf8'
				}
			);
			const output = `${result.stdout}${result.stderr}`;
			expect(result.status, output).toBe(0);
			expect(output).toMatch(/prettier\s+[1-9]\d* file\(s\)/);
			expect(output).not.toContain('prettier         whole project');
		} finally {
			rmSync(checkout.directory, { recursive: true, force: true });
		}
	}, 120_000);
});
