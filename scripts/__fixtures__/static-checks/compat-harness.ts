import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizedGitEnv } from '../../git-context';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Deadlines for one `convex-consumer-compat.ts` child that reaches a verdict, and for the case
 * around it. The child checks out the baseline, runs its frozen install with package scripts,
 * and builds two TypeScript programs over the Convex tree. That work is fixed; its time grows
 * with host load, from about 35 s on an idle host.
 */
export const COMPAT_CHILD_TIMEOUT_MS = 180_000;
export const COMPAT_CASE_TIMEOUT_MS = 240_000;

/**
 * A second checkout of this repository to run the checker against, outside the repository
 * rather than under its `scratch/`. Inside it, the clone is a whole extra copy of the tree
 * that every project-wide tool walks: measured, a full-project format run racing this
 * fixture read the clone's own files and failed a suite whose tracked tree was clean.
 * Killing the test run leaves the copy behind either way, and in the temporary directory
 * that is the operating system's problem instead of the next `eslint .`.
 */
export function createCheckerClone(): { directory: string; repository: string } {
	const directory = mkdtempSync(path.join(tmpdir(), 'static-compat-'));
	const repository = path.join(directory, 'repository');
	try {
		const result = spawnSync(
			'git',
			['clone', '--quiet', '--local', '--no-hardlinks', ROOT, repository],
			{
				env: sanitizedGitEnv(),
				encoding: 'utf8'
			}
		);
		if (result.status !== 0) throw new Error(`Local checker clone failed: ${result.stderr}`);
		symlinkSync(
			path.join(ROOT, 'node_modules'),
			path.join(repository, 'node_modules'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		// Every script, not the three the checker is spelled in. It imports `convex-surface.ts`
		// and `terminal-output.ts` among others, and copying only the entrypoints left those at
		// the committed revision: measured, a working-tree change that made the surface reader
		// throw was invisible to this fixture while the direct checker exited 1 on it.
		cpSync(path.join(ROOT, 'scripts'), path.join(repository, 'scripts'), {
			recursive: true,
			dereference: true
		});
		return { directory, repository };
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

/**
 * A history-free repository that runs this checkout's checker, for cases that read no commit.
 * `scripts/` is copied as in `createCheckerClone`, and every other top-level entry is linked,
 * so imports and configuration resolve against this working tree while `git ls-files` reports
 * each link as one path. It costs no object-store copy or checkout. Prettier's traversal skips
 * links, so a full-project format run here covers only the copied `scripts/`.
 */
export function createCheckerTree(): { directory: string; repository: string } {
	const directory = mkdtempSync(path.join(tmpdir(), 'static-tree-'));
	const repository = path.join(directory, 'repository');
	try {
		mkdirSync(repository);
		const result = spawnSync('git', ['init', '--quiet', '--initial-branch=main', repository], {
			env: sanitizedGitEnv(),
			encoding: 'utf8'
		});
		if (result.status !== 0) throw new Error(`Checker repository init failed: ${result.stderr}`);
		for (const entry of readdirSync(ROOT)) {
			if (entry === '.git' || entry === 'scripts') continue;
			symlinkSync(path.join(ROOT, entry), path.join(repository, entry));
		}
		cpSync(path.join(ROOT, 'scripts'), path.join(repository, 'scripts'), {
			recursive: true,
			dereference: true
		});
		return { directory, repository };
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}
