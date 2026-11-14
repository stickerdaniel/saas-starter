import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCheckerClone } from './__fixtures__/static-checks/compat-harness';
import {
	createPrivateCheckout,
	removePrivateCheckout
} from './__fixtures__/static-checks/private-checkout';
import { sanitizedGitEnv } from './git-context';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUN = testExecutable('bun');

describe('Convex compatibility static-check entrypoint', () => {
	it.skipIf(process.platform === 'win32')(
		'keeps a Unicode consumer path in the deployed contract',
		() => {
			const checkout = createCheckerClone();
			const env = sanitizedGitEnv();
			delete env.CI;
			delete env.CONVEX_COMPAT_BASE;
			const git = (args: string[]) =>
				spawnSync('git', args, {
					cwd: checkout.repository,
					env,
					encoding: 'utf8'
				});
			const commit = (message: string) =>
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
					message
				]);
			try {
				const convexRoot = path.join(checkout.repository, 'src', 'lib', 'convex');
				const target = path.join(convexRoot, 'compatUnicodeTarget.ts');
				const route = path.join(checkout.repository, 'src', 'routes', 'überblick');
				mkdirSync(route, { recursive: true });
				writeFileSync(
					target,
					`import { query } from './_generated/server';

export const viewer = query({ args: {}, handler: async () => null });
`
				);
				writeFileSync(
					path.join(route, '+page.server.ts'),
					`import { api } from '#lib/convex/_generated/api.js';

void api.compatUnicodeTarget.viewer;
`
				);
				expect(git(['add', '--all']).status).toBe(0);
				expect(commit('Add Unicode consumer').status).toBe(0);
				const baseline = git(['rev-parse', 'HEAD']).stdout.trim();
				rmSync(target);
				expect(git(['add', '--all']).status).toBe(0);
				expect(commit('Remove referenced function').status).toBe(0);

				const result = spawnSync(
					BUN,
					[path.join(checkout.repository, 'scripts', 'convex-consumer-compat.ts')],
					{
						cwd: checkout.repository,
						env: { ...env, CONVEX_COMPAT_BASE: baseline },
						encoding: 'utf8',
						timeout: 180_000
					}
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(1);
				expect(output).toContain('compatUnicodeTarget:viewer');
				expect(output).toContain('src/routes/überblick/+page.server.ts');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		240_000
	);

	// The fixture above lives in the temporary directory, and session artifacts still land in
	// `scratch/`. Ask Vitest rather than searching configuration text: the string can survive
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
