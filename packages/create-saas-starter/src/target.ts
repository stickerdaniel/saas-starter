import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
	access,
	chmod,
	lstat,
	mkdir,
	open,
	realpath,
	rename,
	stat,
	unlink
} from 'node:fs/promises';
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

export class TargetClaimError extends Error {
	constructor(
		readonly target: string,
		cause: unknown
	) {
		super(`Target was created but its scaffold marker could not be written: ${target}`, { cause });
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

function markerPath(target: string): string {
	return path.join(target, SCAFFOLD_MARKER);
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
