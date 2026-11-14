import { spawnSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { usePrivateCheckout } from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';

// One full-project format run takes 25 to 50 s on a hosted runner, so it has a file of its own
// that a shard can run beside lighter files.
const checkout = usePrivateCheckout('static-checks-format-project-');

describe('scope routing', () => {
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
});
