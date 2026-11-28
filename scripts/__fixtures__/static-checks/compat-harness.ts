import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	BASE_TABLE,
	WORKSPACES,
	workspaceAt
} from '../../../.agents/skills/upstream-sync/layout/v3';
import { sanitizedGitEnv } from '../../git-context';
import { testExecutable } from '../../test-executable';

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

type Manifest = Record<string, unknown> & {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

const REAL_MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;
const REAL_CONVEX_JSON = JSON.parse(readFileSync(path.join(ROOT, 'convex.json'), 'utf8')) as {
	functions: string;
};

function realVersion(name: string): string {
	const version = REAL_MANIFEST.dependencies?.[name] ?? REAL_MANIFEST.devDependencies?.[name];
	if (!version) throw new Error(`package.json declares no ${name}`);
	return version;
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`;
}

export type CheckoutFiles = Readonly<Record<string, string>>;

export function flatCheckout(
	files: CheckoutFiles,
	manifest: (real: Manifest) => Manifest = (real) => real
): CheckoutFiles {
	const { name, version, templateSetupVersion, type } = REAL_MANIFEST;
	return {
		'.gitignore': 'node_modules\n',
		'bunfig.toml': readFileSync(path.join(ROOT, 'bunfig.toml'), 'utf8'),
		'convex.json': json(REAL_CONVEX_JSON),
		'package.json': json(
			manifest({
				name,
				version,
				templateSetupVersion,
				type,
				dependencies: { convex: realVersion('convex') },
				devDependencies: {
					'@types/node': realVersion('@types/node'),
					typescript: realVersion('typescript')
				}
			})
		),
		'src/lib/convex/tsconfig.json': readFileSync(
			path.join(ROOT, 'src/lib/convex/tsconfig.json'),
			'utf8'
		),
		...files
	};
}

export function memberManifest(name: string, dependencies: Record<string, string> = {}): string {
	return json({
		name,
		version: '0.0.0',
		private: true,
		license: 'MIT',
		type: 'module',
		...(Object.keys(dependencies).length > 0 && { dependencies })
	});
}

export function workspaceCheckout(files: CheckoutFiles): CheckoutFiles {
	const flat = flatCheckout(files);
	const placed: Record<string, string> = {};
	for (const [file, text] of Object.entries(flat)) {
		const to = BASE_TABLE.place(file)?.to ?? file;
		placed[to] = text;
	}
	const config = BASE_TABLE.place('convex.json')!.to!;
	const functions = BASE_TABLE.place(REAL_CONVEX_JSON.functions)!.to!;
	placed[config] = json({
		...REAL_CONVEX_JSON,
		functions: `${path.posix.relative(path.posix.dirname(config), functions)}/`
	});
	const root = JSON.parse(flat['package.json']!) as Manifest;
	const { dependencies: _dependencies, ...rootManifest } = root;
	placed['package.json'] = json({
		...rootManifest,
		templateSetupVersion: 3,
		workspaces: ['apps/*', 'packages/*']
	});
	for (const file of Object.keys(placed)) {
		const workspace = workspaceAt(file);
		if (workspace === 'root') continue;
		const { root: directory, name } = WORKSPACES[workspace];
		placed[`${directory}package.json`] ??= memberManifest(
			name ?? workspace,
			workspace === 'backend' ? { convex: realVersion('convex') } : {}
		);
	}
	return placed;
}

export interface LayoutFixture {
	readonly repository: string;
	checkout(files: CheckoutFiles): void;
	edit(files: Readonly<Record<string, string | null>>): void;
	commit(message: string): string;
	run(): { status: number | null; output: string };
}

export function withLayoutFixture<T>(body: (fixture: LayoutFixture) => T): T {
	const directory = mkdtempSync(path.join(tmpdir(), 'convex-compat-layout-'));
	const repository = path.join(directory, 'repository');
	const env = sanitizedGitEnv();
	delete env.CI;
	delete env.CONVEX_COMPAT_BASE;
	const git = (args: string[]) => {
		const result = spawnSync('git', args, { cwd: repository, env, encoding: 'utf8' });
		if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
		return result.stdout;
	};
	const files = new Map<string, string>();
	const write = (file: string, text: string) => {
		mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
		writeFileSync(path.join(repository, file), text);
		files.set(file, text);
	};
	const fixture: LayoutFixture = {
		repository,
		checkout: (next) => {
			for (const entry of readdirSync(repository)) {
				if (entry === '.git' || entry === 'node_modules') continue;
				rmSync(path.join(repository, entry), { recursive: true, force: true });
			}
			files.clear();
			for (const [file, text] of Object.entries(next)) write(file, text);
		},
		edit: (changes) => {
			for (const [file, text] of Object.entries(changes)) {
				if (text === null) {
					rmSync(path.join(repository, file));
					files.delete(file);
				} else write(file, text);
			}
		},
		commit: (message) => {
			const lock = mkdtempSync(path.join(directory, 'lock-'));
			for (const [file, text] of files) {
				if (path.posix.basename(file) !== 'package.json' && file !== 'bunfig.toml') continue;
				mkdirSync(path.dirname(path.join(lock, file)), { recursive: true });
				writeFileSync(path.join(lock, file), text);
			}
			const install = spawnSync(
				testExecutable('bun'),
				['install', '--lockfile-only', '--prefer-offline'],
				{ cwd: lock, encoding: 'utf8' }
			);
			if (install.status !== 0) {
				throw new Error(`Fixture lockfile failed: ${install.stdout}${install.stderr}`);
			}
			copyFileSync(path.join(lock, 'bun.lock'), path.join(repository, 'bun.lock'));
			rmSync(lock, { recursive: true, force: true });
			git(['add', '--all']);
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
			return git(['rev-parse', 'HEAD']).trim();
		},
		run: () => {
			const result = spawnSync(
				testExecutable('bun'),
				[path.join(ROOT, 'scripts', 'convex-consumer-compat.ts')],
				{ cwd: repository, env, encoding: 'utf8', timeout: COMPAT_CHILD_TIMEOUT_MS }
			);
			return { status: result.status, output: `${result.stdout}${result.stderr}` };
		}
	};
	try {
		mkdirSync(repository);
		git(['init', '--quiet', '--initial-branch=main']);
		symlinkSync(
			path.join(ROOT, 'node_modules'),
			path.join(repository, 'node_modules'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		return body(fixture);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
