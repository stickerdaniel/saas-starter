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
import { generateAuthoredContent } from './generate-authored-content';

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
const SPEC_SUFFIX = '.spec.ts';
const SPEC_EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
	'_generated',
	'tables',
	'middleware'
]);
const CLI_ENTRY = 'node_modules/@confect/cli/bin/confect.mjs';
const NODE_MODULES = 'node_modules';
const GIT_DIRECTORY = '.git';
const GENERATED_MODULE =
	/^(?:"use node";\n\n)?import registeredFunctions from "[^"\n]*\/_generated\/registeredFunctions\/[^"\n]+";\n\n(?:export const experimental_reuseContext = true;\n\n)?(?:export const (\w+) = registeredFunctions\.\1;\n)*$/;

export type CapabilityProfile = 'local' | 'test';

export type Manifest = ReadonlyMap<string, string>;

export type Codegen = (scratch: string, profile: CapabilityProfile) => void;

export type ScratchOptions = {
	codegen?: Codegen;
	prepare?: (scratch: string) => void;
};

export type CodegenResult = {
	added: readonly string[];
	changed: readonly string[];
	removed: readonly string[];
};

export type Push = (scratch: string, signal: AbortSignal) => Promise<void>;

export type GenerateOptions = {
	codegen?: Codegen;
	generateContent?: () => void;
	signal?: AbortSignal;
	onWait?: () => void;
};

type Change = 'created' | 'changed' | 'deleted';

export class CodegenError extends Error {
	override name = 'CodegenError';
}

const GITLINK_MODE = '160000';
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
			else throw new CodegenError(`${absolute} is neither a file, a directory nor a link.`);
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
		throw new CodegenError(
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
			throw new CodegenError(`${current} must be a real directory, not a link or a file.`);
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
		throw new CodegenError(`${root} has a .git entry but is not the top level of a Git checkout.`);
	}
}

export function bunExecutable(): string {
	return process.versions.bun ? process.execPath : 'bun';
}

function gitLsFiles(root: string, args: string[]): string[] {
	const result = spawnSync('git', ['ls-files', '-z', ...args], {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new CodegenError(`git ls-files failed in ${root}:\n${result.stderr}`);
	}
	return result.stdout.split('\0').filter((entry) => entry !== '');
}

function assertNoGitlinks(root: string): void {
	const gitlinks = gitLsFiles(root, ['--stage'])
		.filter((entry) => entry.startsWith(`${GITLINK_MODE} `))
		.map((entry) => entry.slice(entry.indexOf('\t') + 1));
	if (gitlinks.length > 0) {
		throw new CodegenError(
			`${gitlinks.join(', ')} ${gitlinks.length === 1 ? 'is a submodule' : 'are submodules'} in the Git index and cannot be copied.`
		);
	}
}

function walkedFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (relative: string) => {
		for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
			if (entry.name === NODE_MODULES || entry.name === GIT_DIRECTORY) continue;
			const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
			if (entry.isDirectory()) visit(child);
			else files.push(child);
		}
	};
	visit('');
	return files;
}

export function checkoutFiles(root: string): string[] {
	if (!existsSync(path.join(root, GIT_DIRECTORY))) return walkedFiles(root);
	assertGitTopLevel(root);
	assertNoGitlinks(root);
	return [...new Set(gitLsFiles(root, ['--cached', '--others', '--exclude-standard']))];
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
		throw new CodegenError(
			`${file} is a directory in the Git index, such as a submodule, and cannot be copied.`
		);
	}
}

function isOutsideSourceTree(file: string): boolean {
	return !file.startsWith('src/') && file !== NODE_MODULES && !file.startsWith(`${NODE_MODULES}/`);
}

export function prepareScratch(root: string): string {
	const files = checkoutFiles(root).filter(isOutsideSourceTree);
	assertRealWriteRoots(root);
	const scratch = mkdtempSync(path.join(tmpdir(), 'confect-codegen-'));
	try {
		for (const file of files) copyListedFile(root, scratch, file);
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
		throw new CodegenError(
			`confect codegen exited with ${result.status ?? result.signal}:\n${result.stdout}${result.stderr}`
		);
	}
};

export function assertNoLegacySchema(root: string): void {
	if (existsSync(path.join(root, LEGACY_SCHEMA))) {
		throw new CodegenError(
			`${LEGACY_SCHEMA} is not supported by Confect 10.6.0. Declare one table per file in ${CONFECT_DIR}/tables/.`
		);
	}
}

function isInside(file: string, directory: string): boolean {
	return file.startsWith(`${directory}/`);
}

export function groupModules(root: string): Set<string> {
	const confect = path.join(root, CONFECT_DIR);
	const modules = new Set<string>();
	if (!existsSync(confect)) return modules;
	for (const entry of readdirSync(confect, { recursive: true, encoding: 'utf8' })) {
		const relative = entry.split(path.sep).join('/');
		if (!relative.endsWith(SPEC_SUFFIX)) continue;
		if (relative.split('/').some((segment) => SPEC_EXCLUDED_DIRECTORIES.has(segment))) continue;
		modules.add(`${CONVEX_DIR}/${relative.slice(0, -SPEC_SUFFIX.length)}.ts`);
	}
	return modules;
}

export function isGeneratedModule(source: string): boolean {
	return GENERATED_MODULE.test(source);
}

export function generatedModules(root: string): Set<string> {
	const modules = new Set<string>();
	const directory = path.join(root, CONVEX_DIR);
	if (!existsSync(directory)) return modules;
	for (const entry of readdirSync(directory, { recursive: true, encoding: 'utf8' })) {
		const file = `${CONVEX_DIR}/${entry.split(path.sep).join('/')}`;
		if (!file.endsWith('.ts') || isInside(file, CONVEX_GENERATED_DIR)) continue;
		const absolute = path.join(root, file);
		if (!lstatSync(absolute).isFile()) continue;
		if (isGeneratedModule(readFileSync(absolute, 'utf8'))) modules.add(file);
	}
	return modules;
}

type WriteContext = { groups: ReadonlySet<string>; generated: ReadonlySet<string> };

function isCliWrite(file: string, change: Change, context: WriteContext): boolean {
	if (isInside(file, CONFECT_GENERATED_DIR) || isInside(file, CONVEX_GENERATED_DIR)) return true;
	if (!isInside(file, CONVEX_DIR) || !file.endsWith('.ts') || file === CONVEX_CONFIG) return false;
	switch (change) {
		case 'created':
		case 'changed':
			return context.groups.has(file) || RESERVED_CONVEX_MODULES.has(file);
		case 'deleted':
			return context.generated.has(file) && !context.groups.has(file);
	}
}

export function writeSetViolations(
	before: Manifest,
	after: Manifest,
	context: WriteContext
): string[] {
	const violations: string[] = [];
	for (const file of manifestDifference(before, after)) {
		const change: Change = !before.has(file) ? 'created' : !after.has(file) ? 'deleted' : 'changed';
		if (!isCliWrite(file, change, context)) violations.push(`${change} ${file}`);
	}
	for (const file of [...context.groups].sort()) {
		if (!before.has(file) && !after.has(file)) violations.push(`missing ${file}`);
		const registration = `${CONFECT_GENERATED_DIR}/registeredFunctions/${file.slice(CONVEX_DIR.length + 1)}`;
		if (!after.has(registration)) violations.push(`missing ${registration}`);
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
		const context = { groups: groupModules(scratch), generated: generatedModules(scratch) };
		const before = scratchManifest(scratch);
		(options.codegen ?? confectCodegen)(scratch, options.profile ?? 'local');
		const violations = writeSetViolations(before, scratchManifest(scratch), context);
		if (violations.length > 0) {
			throw new CodegenError(
				`confect codegen wrote outside its write sets:\n${violations.map((line) => `  ${line}`).join('\n')}`
			);
		}
		return await run(scratch);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

function replaceFile(destination: string, contents: Buffer): void {
	const temporary = `${destination}.${process.pid}.codegen-tmp`;
	rmSync(temporary, { force: true });
	try {
		writeFileSync(temporary, contents, { flag: 'wx' });
		renameSync(temporary, destination);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

function syncDirectory(source: string, target: string, expected: Manifest): CodegenResult {
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

export function applyWriteSets(scratch: string, root: string): CodegenResult {
	assertRealWriteRoots(root);
	assertRealDirectories(root, CONVEX_DIR);
	const context = { groups: groupModules(scratch), generated: generatedModules(root) };
	const generatedSource = path.join(scratch, CONFECT_GENERATED_DIR);
	const generatedExpected = manifest(generatedSource);
	assertRegularFiles(generatedExpected, generatedSource);
	const generatedTarget = path.join(root, CONFECT_GENERATED_DIR);
	mkdirSync(generatedTarget, { recursive: true });
	const generated = syncDirectory(generatedSource, generatedTarget, generatedExpected);
	const source = manifest(path.join(scratch, CONVEX_DIR));
	const target = manifest(path.join(root, CONVEX_DIR));
	const result = {
		added: generated.added.map((file) => `${CONFECT_GENERATED_DIR}/${file}`),
		changed: generated.changed.map((file) => `${CONFECT_GENERATED_DIR}/${file}`),
		removed: generated.removed.map((file) => `${CONFECT_GENERATED_DIR}/${file}`)
	};
	for (const file of manifestDifference(target, source)) {
		const relative = `${CONVEX_DIR}/${file}`;
		const change: Change = !target.has(file)
			? 'created'
			: !source.has(file)
				? 'deleted'
				: 'changed';
		if (!isCliWrite(relative, change, context)) continue;
		const destination = path.join(root, relative);
		if (change === 'deleted') {
			unlinkSync(destination);
			result.removed.push(relative);
			continue;
		}
		if (!source.get(file)?.startsWith(FILE_PREFIX)) {
			throw new CodegenError(`${relative} in the codegen output is not a regular file.`);
		}
		mkdirSync(path.dirname(destination), { recursive: true });
		replaceFile(destination, readFileSync(path.join(scratch, relative)));
		(change === 'created' ? result.added : result.changed).push(relative);
	}
	return result;
}

export function regenerate(
	root: string,
	options: GenerateOptions & { push?: Push } = {}
): Promise<CodegenResult> {
	(options.generateContent ?? generateAuthoredContent)();
	return withScratchCodegen(
		root,
		async (scratch) => {
			if (options.push && options.signal) await options.push(scratch, options.signal);
			return applyWriteSets(scratch, root);
		},
		{ codegen: options.codegen }
	);
}

export function confectPreflight(
	root: string,
	options: GenerateOptions = {}
): Promise<CodegenResult> {
	return withCheckoutLock(root, () => regenerate(root, options), {
		signal: options.signal,
		onWait: options.onWait
	});
}

async function main(): Promise<void> {
	const result = await confectPreflight(PROJECT_ROOT, {
		onWait: () => console.log('[confect] Waiting for the checkout lock.')
	});
	const changes = result.added.length + result.changed.length + result.removed.length;
	console.log(
		changes === 0
			? '[confect] Generated files are up to date.'
			: `[confect] ${result.added.length} added, ${result.changed.length} changed, ${result.removed.length} removed.`
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
