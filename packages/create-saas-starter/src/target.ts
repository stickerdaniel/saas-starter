import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
	access,
	chmod,
	cp,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	unlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { archivePathForTarget, SCAFFOLD_MARKER, type ValidatedArchive } from './archive.js';
import { CLI_VERSION, isReservedWindowsDeviceName } from './options.js';

export type ScaffoldState = 'incomplete' | 'ready' | 'needs-install';
export type ScaffoldPhase = 'files' | 'setup' | 'install' | 'complete';

export interface ScaffoldMarker {
	version: 1;
	state: ScaffoldState;
	phase: ScaffoldPhase;
	source: 'stickerdaniel/saas-starter';
	ref: string;
	sha: string;
	cliVersion: string;
	archiveSha256: string;
}

export interface TargetPlan {
	path: string;
	parent: string;
}

class TargetClaimError extends Error {
	constructor(
		readonly target: string,
		cause: unknown
	) {
		super(`Target was created but its scaffold marker could not be written: ${target}`, { cause });
	}
}

export class StagingTargetError extends Error {
	constructor(
		readonly recoveryPath: string,
		message: string,
		cause?: unknown
	) {
		super(`${message} Recovery files remain at ${recoveryPath}.`, { cause });
	}
}

async function pathExists(value: string): Promise<boolean> {
	try {
		await lstat(value);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0)!;
		return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
	});
}

function validateTargetBasename(value: string): void {
	if (
		value === '' ||
		value === '.' ||
		value === '..' ||
		hasControlCharacter(value) ||
		value.includes('\\') ||
		/[<>:"|?*]/.test(value) ||
		/[. ]$/.test(value) ||
		isReservedWindowsDeviceName(value) ||
		Buffer.byteLength(value, 'utf8') > 255 ||
		value.length > 255
	) {
		throw new Error('Target directory name is not portable.');
	}
}

export async function inspectTarget(directory: string, cwd = process.cwd()): Promise<TargetPlan> {
	const requested = path.resolve(cwd, directory);
	const current = await realpath(cwd);
	if (requested === path.parse(requested).root)
		throw new Error('The filesystem root is not a target.');
	if (requested === path.resolve(cwd) || requested === current) {
		throw new Error('The current directory is not a target.');
	}
	validateTargetBasename(path.basename(requested));
	if (await pathExists(requested)) throw new Error(`Target already exists: ${requested}`);

	const requestedParent = path.dirname(requested);
	const parentInfo = await stat(requestedParent).catch((error: NodeJS.ErrnoException) => {
		if (error.code === 'ENOENT')
			throw new Error(`Target parent does not exist: ${requestedParent}`);
		throw error;
	});
	if (!parentInfo.isDirectory())
		throw new Error(`Target parent is not a directory: ${requestedParent}`);
	const parent = await realpath(requestedParent);
	const target = path.join(parent, path.basename(requested));
	if (target === current || target === path.parse(target).root)
		throw new Error('The target is not allowed.');
	if (await pathExists(target)) throw new Error(`Target already exists: ${target}`);
	await access(parent, constants.W_OK);
	return { path: target, parent };
}

function isPathWithin(base: string, candidate: string, platform: NodeJS.Platform): boolean {
	const paths = platform === 'win32' ? path.win32 : path.posix;
	const relative = paths.relative(base, candidate);
	return (
		relative === '' ||
		(!relative.startsWith(`..${paths.sep}`) && relative !== '..' && !paths.isAbsolute(relative))
	);
}

async function assertSafePosixStagingRoot(root: string): Promise<void> {
	const effectiveUid = process.geteuid?.();
	if (effectiveUid === undefined) {
		throw new Error('Staging ownership cannot be verified on this platform.');
	}
	const filesystemRoot = path.parse(root).root;
	const relative = path.relative(filesystemRoot, root);
	const ancestors = [filesystemRoot];
	let current = filesystemRoot;
	for (const segment of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		ancestors.push(current);
	}
	for (const ancestor of ancestors) {
		const info = await stat(ancestor);
		if (!info.isDirectory()) throw new Error(`Staging ancestor is not a directory: ${ancestor}`);
		if (info.uid !== 0 && info.uid !== effectiveUid) {
			throw new Error(`Staging ancestor is owned by another user: ${ancestor}`);
		}
		if ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0) {
			throw new Error(
				`The staging root is writable by other users without sticky protection: ${ancestor}`
			);
		}
	}
}

async function assertSafeWindowsStagingRoot(
	root: string,
	environment: NodeJS.ProcessEnv
): Promise<void> {
	const profiles = [environment.LOCALAPPDATA, environment.USERPROFILE].filter(
		(value): value is string => value !== undefined
	);
	for (const profile of profiles) {
		const canonicalProfile = await realpath(profile).catch(() => undefined);
		if (canonicalProfile && isPathWithin(canonicalProfile, root, 'win32')) return;
	}
	throw new Error('The Windows staging directory is outside the current user profile.');
}

async function defaultStagingRoot(
	platform: NodeJS.Platform,
	environment: NodeJS.ProcessEnv
): Promise<string> {
	if (platform !== 'win32') return await realpath(tmpdir());
	const profile = environment.LOCALAPPDATA ?? environment.USERPROFILE;
	if (!profile) throw new Error('A per-user Windows profile directory is required for staging.');
	const canonicalProfile = await realpath(profile);
	const root = path.join(canonicalProfile, '.create-saas-starter');
	await mkdir(root, { recursive: true, mode: 0o700 });
	const canonicalRoot = await realpath(root);
	if (!isPathWithin(canonicalProfile, canonicalRoot, platform)) {
		throw new Error('The Windows staging directory escaped the current user profile.');
	}
	return canonicalRoot;
}

export interface StagingTargetOptions {
	platform?: NodeJS.Platform;
	environment?: NodeJS.ProcessEnv;
	root?: string;
	device?: (value: string) => Promise<number>;
}

export async function createStagingTarget(
	plan: TargetPlan,
	marker: ScaffoldMarker,
	signal: AbortSignal,
	options: StagingTargetOptions = {}
): Promise<string> {
	throwIfAborted(signal);
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	let root = await realpath(options.root ?? (await defaultStagingRoot(platform, environment)));
	if (platform === 'win32') await assertSafeWindowsStagingRoot(root, environment);
	else {
		await assertSafePosixStagingRoot(root);
		const device = options.device ?? (async (value: string) => (await stat(value)).dev);
		if ((await device(root)) !== (await device(plan.parent))) {
			root = plan.parent;
			await assertSafePosixStagingRoot(root);
		}
	}
	const staging = await mkdtemp(path.join(root, 'create-saas-starter-'));
	await chmod(staging, 0o700);
	try {
		throwIfAborted(signal);
		await writeExclusive(markerPath(staging), `${JSON.stringify(marker, null, 2)}\n`, 0o600);
		throwIfAborted(signal);
	} catch (error) {
		if (error instanceof StagingTargetError) throw error;
		throw new StagingTargetError(staging, 'The staging directory could not be prepared.', error);
	}
	return staging;
}

function markerPath(target: string): string {
	return path.join(target, SCAFFOLD_MARKER);
}

// macOS has the tightest supported POSIX PATH_MAX: 1024 UTF-8 bytes including NUL.
const PORTABLE_POSIX_PATH_BYTES = 1024;
// Legacy Win32 file APIs allow 260 UTF-16 code units including NUL; directories need 12 fewer.
const PORTABLE_WINDOWS_PATH_UNITS = 260;
const PORTABLE_WINDOWS_DIRECTORY_PATH_UNITS = PORTABLE_WINDOWS_PATH_UNITS - 12;
const MAX_PROCESS_ID_DIGITS = 10;
const MAX_TEMPORARY_MARKER_NAME = `${SCAFFOLD_MARKER}.tmp-${'9'.repeat(MAX_PROCESS_ID_DIGITS)}-00000000-0000-4000-8000-000000000000`;

function assertPortablePathLength(
	value: string,
	description: string,
	windowsLimit = PORTABLE_WINDOWS_PATH_UNITS
): void {
	const posixBytesWithTerminator = Buffer.byteLength(value, 'utf8') + 1;
	if (posixBytesWithTerminator > PORTABLE_POSIX_PATH_BYTES) {
		throw new Error(
			`Target path is not portable: ${description} exceeds ${PORTABLE_POSIX_PATH_BYTES} POSIX bytes.`
		);
	}
	const windowsUnitsWithTerminator = value.length + 1;
	if (windowsUnitsWithTerminator > windowsLimit) {
		throw new Error(
			`Target path is not portable: ${description} exceeds ${windowsLimit} Windows UTF-16 code units.`
		);
	}
}

export function validateArchiveTargetPaths(target: string, archive: ValidatedArchive): void {
	if (!path.isAbsolute(target))
		throw new Error('Target path must be absolute before archive validation.');
	assertPortablePathLength(target, 'target directory', PORTABLE_WINDOWS_DIRECTORY_PATH_UNITS);
	assertPortablePathLength(markerPath(target), 'scaffold marker');
	assertPortablePathLength(
		path.join(target, MAX_TEMPORARY_MARKER_NAME),
		'temporary scaffold marker'
	);
	for (const entry of archive.files) {
		const destination = archivePathForTarget(target, entry.path);
		if (entry.type === 'directory') {
			assertPortablePathLength(
				destination,
				`archive directory ${JSON.stringify(entry.path)}`,
				PORTABLE_WINDOWS_DIRECTORY_PATH_UNITS
			);
		} else {
			assertPortablePathLength(
				path.dirname(destination),
				`archive parent directory for ${JSON.stringify(entry.path)}`,
				PORTABLE_WINDOWS_DIRECTORY_PATH_UNITS
			);
			assertPortablePathLength(destination, `archive file ${JSON.stringify(entry.path)}`);
		}
	}
}

async function writeExclusive(file: string, data: Buffer | string, mode: number): Promise<void> {
	const handle = await open(file, 'wx', mode);
	try {
		await handle.writeFile(data);
	} finally {
		await handle.close();
	}
	await chmod(file, mode);
}

export async function claimTarget(
	plan: TargetPlan,
	marker: ScaffoldMarker,
	signal: AbortSignal
): Promise<void> {
	throwIfAborted(signal);
	await mkdir(plan.path, { mode: 0o755 });
	try {
		throwIfAborted(signal);
		await writeExclusive(markerPath(plan.path), `${JSON.stringify(marker, null, 2)}\n`, 0o600);
		throwIfAborted(signal);
	} catch (error) {
		throw new TargetClaimError(plan.path, error);
	}
}

class TargetPublishError extends Error {
	constructor(
		readonly target: string,
		readonly recoveryPath: string,
		cause: unknown
	) {
		super(`The final target could not be published. Recovery files remain at ${recoveryPath}.`, {
			cause
		});
	}
}

export interface PublishStagedTargetOptions {
	platform?: NodeJS.Platform;
	copy?: typeof cp;
	cleanup?: (value: string) => Promise<void>;
}

export async function publishStagedTarget(
	plan: TargetPlan,
	staging: string,
	signal: AbortSignal,
	options: PublishStagedTargetOptions = {}
): Promise<void> {
	throwIfAborted(signal);
	const platform = options.platform ?? process.platform;
	const copy = options.copy ?? cp;
	let pendingMarker: string | undefined;
	try {
		await mkdir(plan.path, { mode: 0o755 });
		throwIfAborted(signal);
		if (platform !== 'win32') {
			await rename(staging, plan.path);
			return;
		}
		for (const entry of (await readdir(staging)).filter((entry) => entry !== SCAFFOLD_MARKER)) {
			throwIfAborted(signal);
			await copy(path.join(staging, entry), path.join(plan.path, entry), {
				recursive: true,
				force: false,
				errorOnExist: true,
				preserveTimestamps: true,
				verbatimSymlinks: true
			});
		}
		throwIfAborted(signal);
		pendingMarker = path.join(plan.path, `${SCAFFOLD_MARKER}.publish-${randomUUID()}`);
		await copy(markerPath(staging), pendingMarker, {
			force: false,
			errorOnExist: true,
			preserveTimestamps: true
		});
		throwIfAborted(signal);
		await rename(pendingMarker, markerPath(plan.path));
		pendingMarker = undefined;
	} catch (error) {
		if (pendingMarker) await unlink(pendingMarker).catch(() => {});
		throw new TargetPublishError(plan.path, staging, error);
	}
	const cleanup =
		options.cleanup ??
		(async (value: string) => {
			await rm(value, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
		});
	await cleanup(staging).catch(() => {});
}

export function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new Error('Scaffold write aborted.');
}

export async function writeArchive(
	target: string,
	archive: ValidatedArchive,
	signal: AbortSignal
): Promise<void> {
	throwIfAborted(signal);
	const directories = new Set<string>(['']);
	for (const entry of archive.files) {
		const segments = entry.path.split('/');
		const end = entry.type === 'directory' ? segments.length : segments.length - 1;
		for (let index = 1; index <= end; index++) directories.add(segments.slice(0, index).join('/'));
	}
	for (const directory of [...directories].filter(Boolean).sort((a, b) => {
		const depth = a.split('/').length - b.split('/').length;
		return depth || a.localeCompare(b);
	})) {
		throwIfAborted(signal);
		await mkdir(archivePathForTarget(target, directory), { mode: 0o755 });
		throwIfAborted(signal);
	}
	for (const entry of archive.files) {
		if (entry.type === 'directory') continue;
		throwIfAborted(signal);
		await writeExclusive(
			archivePathForTarget(target, entry.path),
			entry.data ?? Buffer.alloc(0),
			entry.mode
		);
		throwIfAborted(signal);
	}
}

export async function updateMarker(
	target: string,
	marker: ScaffoldMarker,
	state: ScaffoldState,
	phase: ScaffoldPhase
): Promise<ScaffoldMarker> {
	const next = { ...marker, state, phase };
	const temporary = path.join(target, `${SCAFFOLD_MARKER}.tmp-${process.pid}-${randomUUID()}`);
	try {
		await writeExclusive(temporary, `${JSON.stringify(next, null, 2)}\n`, 0o600);
		await rename(temporary, markerPath(target));
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
	return next;
}

export function initialMarker(input: {
	ref: string;
	sha: string;
	archiveSha256: string;
}): ScaffoldMarker {
	return {
		version: 1,
		state: 'incomplete',
		phase: 'files',
		source: 'stickerdaniel/saas-starter',
		ref: input.ref,
		sha: input.sha,
		cliVersion: CLI_VERSION,
		archiveSha256: input.archiveSha256
	};
}
