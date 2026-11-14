import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizedGitEnv } from '../../git-context';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
