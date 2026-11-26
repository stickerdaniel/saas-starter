import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	createPrivateCheckout,
	removePrivateCheckout
} from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUN = testExecutable('bun');

describe('Convex compatibility static-check entrypoint', () => {
	// Session artifacts land in `scratch/`. Ask Vitest rather than searching configuration text: the string can survive
	// in a comment after the effective exclusion is removed. Asking means loading the real
	// config, which is the cost of this case: observed 2026-10-10, discovery alone took 0.2 s
	// while loading the config took 1.5 s, and the case took 2 s idle and 9 to 18 s with 12
	// to 24 copies beside 48 CPU burners on 24 cores. The blocking child gets its own
	// deadline because Vitest cannot interrupt it. The sentinels and the SvelteKit sync the
	// config runs stay in a private checkout.
	it('keeps session scratch and nested agent worktrees out of Vitest discovery', () => {
		const checkout = createPrivateCheckout('static-compat-discovery-');
		try {
			for (const parent of ['scratch', '.claude/worktrees']) {
				const directory = path.join(checkout.repository, parent, 'compat-discovery');
				mkdirSync(directory, { recursive: true });
				writeFileSync(
					path.join(directory, 'sentinel.test.ts'),
					"throw new Error('collected session sentinel');\n"
				);
			}
			const result = spawnSync(BUN, ['vitest', 'list', '--filesOnly'], {
				cwd: checkout.repository,
				env: sanitizedGitEnv(),
				encoding: 'utf8',
				timeout: 50_000
			});
			expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
			expect(`${result.stdout}${result.stderr}`).not.toContain('sentinel.test.ts');
			expect(result.stdout).toContain('scripts/static-checks.compat.test.ts');
		} finally {
			removePrivateCheckout(checkout);
		}
	}, 60_000);

	it('owns the package alias', () => {
		const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts['check:convex-compat']).toBe(
			'bun scripts/static-checks.ts --scope compat'
		);
	});
});
