/**
 * A private copy of this checkout under the temporary directory, for tests that create
 * source files. Whole-tree readers that concurrent runs start in the shared checkout
 * (oxlint, knip, ESLint, Prettier, the prose and pattern scans, type checks) never see a
 * file written here.
 *
 * The copy is a depth-1 clone whose HEAD and index equal the source's current tracked state:
 * the source index decides which paths exist, and the working tree supplies their bytes.
 * Untracked source files are not copied. `node_modules` is a real directory of links into the
 * source's packages, so SvelteKit sync output (`$app`) and tool caches (`.vite`, `.cache`)
 * land in the copy instead of the shared tree.
 */
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll } from 'vitest';
import { sanitizedGitEnv } from '../../git-context';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface PrivateCheckout {
	/** The owned temporary directory; removing it removes everything below. */
	directory: string;
	/** The private repository inside `directory`. */
	repository: string;
}

function git(cwd: string, args: string[], input?: string): string {
	const result = spawnSync('git', ['-c', 'maintenance.auto=false', ...args], {
		cwd,
		env: sanitizedGitEnv(),
		encoding: 'utf8',
		input,
		maxBuffer: 64 * 1024 * 1024
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stdout}${result.stderr}`);
	}
	return result.stdout;
}

function records(output: string): string[] {
	return output.split('\0').filter(Boolean);
}

function isInside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function lstatOrUndefined(file: string) {
	try {
		return lstatSync(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}

/**
 * The absolute private path of a repository-relative Git path, or `undefined` when an ancestor
 * is missing or a file, so nothing can exist there. A linked ancestor throws: a write or
 * removal through it would land outside the private tree. With `createParents`, missing
 * ancestors are created instead.
 */
function privatePath(repository: string, relative: string, createParents: true): string;
function privatePath(
	repository: string,
	relative: string,
	createParents: false
): string | undefined;
function privatePath(
	repository: string,
	relative: string,
	createParents: boolean
): string | undefined {
	const target = path.join(repository, relative);
	if (!isInside(repository, target) || target === repository) {
		throw new Error(`Git path leaves the private checkout: ${relative}`);
	}
	let ancestor = repository;
	for (const segment of path.dirname(relative).split('/')) {
		if (segment === '.') break;
		ancestor = path.join(ancestor, segment);
		const entry = lstatOrUndefined(ancestor);
		if (entry?.isSymbolicLink()) {
			throw new Error(`Refusing to write through the linked ancestor ${ancestor}`);
		}
		if (entry?.isDirectory()) continue;
		if (!createParents) return undefined;
		if (entry) throw new Error(`A file blocks the private directory ${ancestor}`);
		mkdirSync(ancestor);
	}
	return target;
}

function removePrivatePath(repository: string, relative: string): void {
	const target = privatePath(repository, relative, false);
	if (target) rmSync(target, { recursive: true, force: true });
}

/**
 * The working-tree entry of an indexed path, read without following any ancestor. A missing or
 * file ancestor means the path is absent, which Git records as a deletion. A linked ancestor
 * throws: reading through it would commit bytes from outside the source.
 */
function sourceEntry(source: string, relative: string) {
	let ancestor = source;
	for (const segment of path.dirname(relative).split('/')) {
		if (segment === '.') break;
		ancestor = path.join(ancestor, segment);
		const entry = lstatOrUndefined(ancestor);
		if (entry?.isSymbolicLink()) {
			throw new Error(`Refusing to read through the linked source ancestor ${ancestor}`);
		}
		if (!entry?.isDirectory()) return undefined;
	}
	return lstatOrUndefined(path.join(source, relative));
}

/**
 * Makes the private tree match the source's index and working tree, and returns the indexed
 * paths it wrote. Membership comes from the source index: a staged deletion stays deleted even
 * while its file is still on disk. Bytes come from the working tree: a staged file edited again
 * carries the newer edit. Removals run first and deepest first, so a directory that becomes a
 * file is gone before the file is written and a file that becomes a directory is gone before
 * its children are. `rmSync` removes a link itself, never its target.
 */
function overlay(source: string, repository: string): string[] {
	const indexed = new Set(records(git(source, ['ls-files', '-z'])));
	const deleted = records(
		git(source, [
			'diff',
			'--cached',
			'--name-only',
			'--no-renames',
			'-z',
			'--diff-filter=D',
			'HEAD'
		])
	);
	const changed = records(
		git(source, ['diff', '--name-only', '--no-renames', '-z', 'HEAD'])
	).filter((file) => indexed.has(file));

	const depth = (file: string) => file.split('/').length;
	for (const file of [...deleted].sort((a, b) => depth(b) - depth(a))) {
		removePrivatePath(repository, file);
	}
	for (const file of changed) {
		const target = privatePath(repository, file, false);
		if (target && lstatOrUndefined(target)?.isDirectory()) removePrivatePath(repository, file);
	}

	const written: string[] = [];
	for (const file of [...changed].sort((a, b) => depth(a) - depth(b))) {
		const origin = path.join(source, file);
		const entry = sourceEntry(source, file);
		if (!entry?.isFile() && !entry?.isSymbolicLink()) {
			// Missing from the working tree as a file or link, which Git records as a deletion.
			removePrivatePath(repository, file);
			continue;
		}
		const target = privatePath(repository, file, true);
		rmSync(target, { force: true });
		if (entry.isSymbolicLink()) {
			symlinkSync(readlinkSync(origin), target);
		} else {
			copyFileSync(origin, target);
			chmodSync(target, entry.mode & 0o777);
		}
		written.push(file);
	}
	return written;
}

/**
 * Builds a real `node_modules` in `repository` that links every top-level package of the
 * source's `node_modules`. `source` is a physical path. `$app` and dot entries other than `.bin`
 * stay out: SvelteKit sync writes `$app/types` and `$app/tsconfig.json` relative to
 * the project root, and Vite, Vitest and jiti write `.vite`, `.vite-temp`, `.vitest-cache` and
 * `.cache` there, so linking them would send a private run's output into the shared tree.
 */
export function linkDependencies(source: string, repository: string): void {
	const sourceModules = path.join(source, 'node_modules');
	if (!lstatOrUndefined(sourceModules)) return;
	const privateModules = path.join(repository, 'node_modules');
	mkdirSync(privateModules);
	for (const name of readdirSync(sourceModules)) {
		if (name === '$app' || (name.startsWith('.') && name !== '.bin')) continue;
		const target = path.join(sourceModules, name);
		const type = statSync(target).isDirectory()
			? process.platform === 'win32'
				? 'junction'
				: 'dir'
			: 'file';
		symlinkSync(target, path.join(privateModules, name), type);
	}
}

/**
 * Allocates a private checkout of `source` in a new `prefix`-named temporary directory. The
 * directory is owned from the moment it exists, so a failed setup removes it before
 * rethrowing.
 */
export function createPrivateCheckout(prefix: string, source: string = ROOT): PrivateCheckout {
	const sourceRoot = realpathSync.native(source);
	const directory = realpathSync.native(
		mkdtempSync(path.join(realpathSync.native(tmpdir()), prefix))
	);
	const checkout = { directory, repository: path.join(directory, 'repository') };
	try {
		if (isInside(sourceRoot, directory)) {
			throw new Error(`The temporary directory ${directory} is inside ${sourceRoot}.`);
		}
		const url = pathToFileURL(sourceRoot).href;
		git(directory, ['clone', '--quiet', '--no-local', '--depth', '1', url, checkout.repository]);
		const written = overlay(sourceRoot, checkout.repository);
		git(checkout.repository, ['add', '-A']);
		// Forced, because the source index can hold a path an ignore rule covers (`git add -f`),
		// and `add -A` leaves such a new path out. Only indexed paths are named, so untracked
		// source files stay out.
		if (written.length > 0) {
			git(
				checkout.repository,
				['--literal-pathspecs', 'add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul'],
				`${written.join('\0')}\0`
			);
		}
		git(checkout.repository, [
			'-c',
			'user.name=Probe',
			'-c',
			'user.email=probe@example.com',
			'commit',
			'--quiet',
			'--no-verify',
			'--no-gpg-sign',
			'--allow-empty',
			'-m',
			'Private checkout'
		]);
		linkDependencies(sourceRoot, checkout.repository);
		return checkout;
	} catch (error) {
		removePrivateCheckout(checkout);
		throw error;
	}
}

/** Removes a checkout. Terminate and join every child that runs inside it first. */
export function removePrivateCheckout(checkout: PrivateCheckout): void {
	rmSync(checkout.directory, { recursive: true, force: true });
}

/**
 * One private checkout for the calling test file, created before its first test and removed
 * after its last. Cases that share it remove what they write.
 */
export function usePrivateCheckout(prefix: string): () => PrivateCheckout {
	let checkout: PrivateCheckout | undefined;
	beforeAll(() => {
		checkout = createPrivateCheckout(prefix);
	}, 120_000);
	afterAll(() => {
		if (checkout) removePrivateCheckout(checkout);
	});
	return () => {
		if (!checkout) throw new Error('The private checkout is used outside its test file hooks.');
		return checkout;
	};
}
