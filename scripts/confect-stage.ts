#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmdirSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withCheckoutLock } from './checkout-lock';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

export const CONFECT_DIR = 'src/lib/confect';
export const CONFECT_GENERATED_DIR = `${CONFECT_DIR}/_generated`;
export const CONVEX_DIR = 'src/lib/convex';
const CONVEX_GENERATED_DIR = `${CONVEX_DIR}/_generated`;
const CONVEX_CONFIG = `${CONVEX_DIR}/convex.config.ts`;
const RESERVED_CONVEX_MODULES: ReadonlySet<string> = new Set(
	['schema.ts', 'http.ts', 'crons.ts', 'auth.config.ts'].map((name) => `${CONVEX_DIR}/${name}`)
);
const WRITE_ROOTS = [CONVEX_GENERATED_DIR, CONFECT_GENERATED_DIR];
const LEGACY_SCHEMA = `${CONFECT_DIR}/schema.ts`;
const CLI_ENTRY = 'node_modules/@confect/cli/bin/confect.mjs';
const NODE_MODULES = 'node_modules';

export const LEGACY_CONVEX_MODULE_DELETIONS_ALLOWED = true;

export type CapabilityProfile = 'local' | 'test';

export type Manifest = ReadonlyMap<string, string>;

export type Codegen = (scratch: string, profile: CapabilityProfile) => void;

export type ScratchOptions = {
	codegen?: Codegen;
	prepare?: (scratch: string) => void;
};

export type StageResult = {
	added: readonly string[];
	changed: readonly string[];
	removed: readonly string[];
};

type Change = 'created' | 'changed' | 'deleted';

export class StageError extends Error {
	override name = 'StageError';
}

const FILE_PREFIX = 'file:';
const LINK_PREFIX = 'link:';

export function manifest(
	directory: string,
	options: { exclude?: (relative: string) => boolean } = {}
): Manifest {
	const entries = new Map<string, string>();
	if (!existsSync(directory)) return entries;
	const visit = (relative: string) => {
		for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
			const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
			if (options.exclude?.(child)) continue;
			const absolute = path.join(directory, child);
			if (entry.isSymbolicLink()) entries.set(child, `${LINK_PREFIX}${readlinkSync(absolute)}`);
			else if (entry.isDirectory()) visit(child);
			else if (entry.isFile()) entries.set(child, `${FILE_PREFIX}${hashFile(absolute)}`);
			else throw new StageError(`${absolute} is neither a file, a directory nor a link.`);
		}
	};
	visit('');
	return new Map([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function manifestDifference(expected: Manifest, actual: Manifest): string[] {
	const paths = new Set([...expected.keys(), ...actual.keys()]);
	return [...paths].filter((file) => expected.get(file) !== actual.get(file)).sort();
}

function hashFile(file: string): string {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function assertRegularFiles(entries: Manifest, directory: string): void {
	const links = [...entries].filter(([, entry]) => !entry.startsWith(FILE_PREFIX));
	if (links.length > 0) {
		throw new StageError(
			`${directory} may hold only regular files and directories; found links: ${links.map(([file]) => file).join(', ')}`
		);
	}
}

function assertRealDirectories(root: string, relative: string): void {
	const segments = relative.split('/');
	for (let index = 1; index <= segments.length; index++) {
		const current = path.join(root, ...segments.slice(0, index));
		let stats;
		try {
			stats = lstatSync(current);
		} catch {
			return;
		}
		if (stats.isSymbolicLink() || !stats.isDirectory()) {
			throw new StageError(`${current} must be a real directory, not a link or a file.`);
		}
	}
}

function assertRealWriteRoots(root: string): void {
	for (const directory of WRITE_ROOTS) assertRealDirectories(root, directory);
}

function assertGitTopLevel(root: string): void {
	const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
		cwd: root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const topLevel = result.status === 0 ? result.stdout.trim() : undefined;
	if (topLevel === undefined || realpathSync.native(topLevel) !== realpathSync.native(root)) {
		throw new StageError(
			`${root} is not the top level of a Git checkout. Run git init in ${root}.`
		);
	}
}

function bunExecutable(): string {
	return process.versions.bun ? process.execPath : 'bun';
}

function listedFiles(root: string): string[] {
	const result = spawnSync(
		'git',
		['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
		{
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new StageError(`git ls-files failed in ${root}:\n${result.stderr}`);
	}
	return [...new Set(result.stdout.split('\0').filter((file) => file !== ''))];
}

function copyListedFile(root: string, scratch: string, file: string): void {
	const source = path.join(root, file);
	let stats;
	try {
		stats = lstatSync(source);
	} catch {
		return;
	}
	const destination = path.join(scratch, file);
	if (stats.isSymbolicLink()) {
		mkdirSync(path.dirname(destination), { recursive: true });
		symlinkSync(readlinkSync(source), destination);
	} else if (stats.isFile()) {
		mkdirSync(path.dirname(destination), { recursive: true });
		copyFileSync(source, destination);
	} else if (stats.isDirectory()) {
		throw new StageError(
			`${file} is a directory in the Git index, such as a submodule, and cannot be staged.`
		);
	}
}

function isOutsideSourceTree(file: string): boolean {
	return !file.startsWith('src/') && file !== NODE_MODULES && !file.startsWith(`${NODE_MODULES}/`);
}

export function prepareScratch(root: string): string {
	assertGitTopLevel(root);
	assertRealWriteRoots(root);
	const scratch = mkdtempSync(path.join(tmpdir(), 'confect-stage-'));
	try {
		for (const file of listedFiles(root).filter(isOutsideSourceTree)) {
			copyListedFile(root, scratch, file);
		}
		const generated = path.join(root, CONFECT_GENERATED_DIR);
		cpSync(path.join(root, 'src'), path.join(scratch, 'src'), {
			recursive: true,
			verbatimSymlinks: true,
			filter: (source) => source !== generated
		});
		symlinkSync(path.join(root, NODE_MODULES), path.join(scratch, NODE_MODULES), 'junction');
		return scratch;
	} catch (error) {
		rmSync(scratch, { recursive: true, force: true });
		throw error;
	}
}

export const confectCodegen: Codegen = (scratch, profile) => {
	const result = spawnSync(bunExecutable(), [path.join(scratch, CLI_ENTRY), 'codegen'], {
		cwd: scratch,
		encoding: 'utf8',
		env: { ...process.env, CAPABILITY_PROFILE: profile },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new StageError(
			`confect codegen exited with ${result.status ?? result.signal}:\n${result.stdout}${result.stderr}`
		);
	}
};

export function assertNoLegacySchema(root: string): void {
	if (existsSync(path.join(root, LEGACY_SCHEMA))) {
		throw new StageError(
			`${LEGACY_SCHEMA} is not supported by Confect 10.6.0. Declare one table per file in ${CONFECT_DIR}/tables/.`
		);
	}
}

function isInside(file: string, directory: string): boolean {
	return file.startsWith(`${directory}/`);
}

function isCliWrite(file: string, change: Change): boolean {
	if (isInside(file, CONFECT_GENERATED_DIR) || isInside(file, CONVEX_GENERATED_DIR)) return true;
	if (!isInside(file, CONVEX_DIR) || !file.endsWith('.ts') || file === CONVEX_CONFIG) return false;
	switch (change) {
		case 'created':
			return true;
		case 'changed':
			return RESERVED_CONVEX_MODULES.has(file);
		case 'deleted':
			return LEGACY_CONVEX_MODULE_DELETIONS_ALLOWED;
	}
}

export function writeSetViolations(before: Manifest, after: Manifest): string[] {
	const violations: string[] = [];
	for (const file of manifestDifference(before, after)) {
		const change: Change = !before.has(file) ? 'created' : !after.has(file) ? 'deleted' : 'changed';
		if (!isCliWrite(file, change)) violations.push(`${change} ${file}`);
	}
	return violations;
}

function scratchManifest(scratch: string): Manifest {
	return manifest(scratch, { exclude: (relative) => relative === NODE_MODULES });
}

export async function withScratchCodegen<T>(
	root: string,
	run: (scratch: string) => Promise<T> | T,
	options: ScratchOptions & { profile?: CapabilityProfile } = {}
): Promise<T> {
	assertNoLegacySchema(root);
	const scratch = prepareScratch(root);
	try {
		options.prepare?.(scratch);
		assertRealWriteRoots(scratch);
		const before = scratchManifest(scratch);
		(options.codegen ?? confectCodegen)(scratch, options.profile ?? 'local');
		const violations = writeSetViolations(before, scratchManifest(scratch));
		if (violations.length > 0) {
			throw new StageError(
				`confect codegen wrote outside its write sets:\n${violations.map((line) => `  ${line}`).join('\n')}`
			);
		}
		return await run(scratch);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

function replaceFile(destination: string, contents: Buffer): void {
	const temporary = `${destination}.${process.pid}.stage-tmp`;
	rmSync(temporary, { force: true });
	try {
		writeFileSync(temporary, contents, { flag: 'wx' });
		renameSync(temporary, destination);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

function syncDirectory(source: string, target: string, expected: Manifest): StageResult {
	const current = manifest(target);
	assertRegularFiles(current, target);
	const added: string[] = [];
	const changed: string[] = [];
	const removed: string[] = [];
	for (const file of current.keys()) {
		if (!expected.has(file)) {
			unlinkSync(path.join(target, file));
			removed.push(file);
		}
	}
	for (const [file, entry] of expected) {
		const previous = current.get(file);
		if (previous === entry) continue;
		const destination = path.join(target, file);
		mkdirSync(path.dirname(destination), { recursive: true });
		replaceFile(destination, readFileSync(path.join(source, file)));
		(previous === undefined ? added : changed).push(file);
	}
	removeEmptyDirectories(target);
	return { added, changed, removed };
}

function removeEmptyDirectories(directory: string): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const child = path.join(directory, entry.name);
		removeEmptyDirectories(child);
		if (readdirSync(child).length === 0) rmdirSync(child);
	}
}

export async function stage(
	root: string,
	options: { codegen?: Codegen } = {}
): Promise<StageResult> {
	return withCheckoutLock(root, () => {
		const convexBefore = manifest(path.join(root, CONVEX_DIR));
		return withScratchCodegen(
			root,
			(scratch) => {
				const source = path.join(scratch, CONFECT_GENERATED_DIR);
				const expected = manifest(source);
				assertRegularFiles(expected, source);
				if (expected.size === 0) {
					throw new StageError(`confect codegen wrote nothing into ${CONFECT_GENERATED_DIR}.`);
				}
				assertRealDirectories(root, CONFECT_GENERATED_DIR);
				const target = path.join(root, CONFECT_GENERATED_DIR);
				mkdirSync(target, { recursive: true });
				const result = syncDirectory(source, target, expected);
				const mismatched = manifestDifference(expected, manifest(target));
				if (mismatched.length > 0) {
					throw new StageError(
						`${CONFECT_GENERATED_DIR} differs from the codegen output after the copy: ${mismatched.join(', ')}`
					);
				}
				const convexChanged = manifestDifference(
					convexBefore,
					manifest(path.join(root, CONVEX_DIR))
				);
				if (convexChanged.length > 0) {
					throw new StageError(
						`${CONVEX_DIR} changed during the staging run: ${convexChanged.join(', ')}`
					);
				}
				return result;
			},
			options
		);
	});
}

async function main(): Promise<void> {
	const result = await stage(PROJECT_ROOT);
	const changes = result.added.length + result.changed.length + result.removed.length;
	console.log(
		changes === 0
			? `${CONFECT_GENERATED_DIR} is up to date.`
			: `${CONFECT_GENERATED_DIR}: ${result.added.length} added, ${result.changed.length} changed, ${result.removed.length} removed.`
	);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
