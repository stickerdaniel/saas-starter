import { createHash } from 'node:crypto';
import {
	closeSync,
	openSync,
	readFileSync,
	realpathSync,
	statSync,
	unlinkSync,
	writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const POLL_MS = 50;
const UNWRITTEN_OWNER_ABANDONED_MS = 10_000;
const RECLAIM_ABANDONED_MS = 10_000;

export function checkoutLockPath(root: string): string {
	const checkout = realpathSync.native(root);
	const key = createHash('sha256').update(checkout).digest('hex').slice(0, 16);
	return path.join(tmpdir(), `checkout-lock-${key}.lock`);
}

export async function withCheckoutLock<T>(
	root: string,
	run: () => Promise<T> | T,
	onWait?: () => void
): Promise<T> {
	const lockPath = checkoutLockPath(root);
	let release = tryAcquire(lockPath);
	if (!release) onWait?.();
	while (!release) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		release = tryAcquire(lockPath);
	}
	try {
		return await run();
	} finally {
		release();
	}
}

function tryAcquire(lockPath: string): (() => void) | undefined {
	let descriptor: number;
	try {
		descriptor = openSync(lockPath, 'wx');
	} catch (error) {
		if (errorCode(error) !== 'EEXIST') throw error;
		removeIfAbandoned(lockPath);
		return undefined;
	}
	try {
		writeSync(descriptor, String(process.pid));
	} finally {
		closeSync(descriptor);
	}
	const release = () => {
		process.off('exit', release);
		try {
			if (lockOwner(lockPath) === process.pid) unlinkSync(lockPath);
		} catch {
			return;
		}
	};
	process.on('exit', release);
	return release;
}

function removeIfAbandoned(lockPath: string): void {
	if (!isAbandoned(lockPath)) return;
	const reclaimPath = `${lockPath}.reclaim`;
	let descriptor: number;
	try {
		descriptor = openSync(reclaimPath, 'wx');
	} catch (error) {
		if (errorCode(error) !== 'EEXIST') throw error;
		const age = fileAge(reclaimPath);
		if (age !== undefined && age > RECLAIM_ABANDONED_MS) removeFile(reclaimPath);
		return;
	}
	closeSync(descriptor);
	try {
		if (isAbandoned(lockPath)) removeFile(lockPath);
	} finally {
		removeFile(reclaimPath);
	}
}

function isAbandoned(lockPath: string): boolean {
	const age = fileAge(lockPath);
	if (age === undefined) return false;
	const owner = lockOwner(lockPath);
	if (owner === undefined) return age > UNWRITTEN_OWNER_ABANDONED_MS;
	return !isRunning(owner);
}

function fileAge(file: string): number | undefined {
	try {
		return Date.now() - statSync(file).mtimeMs;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined;
		throw error;
	}
}

function removeFile(file: string): void {
	try {
		unlinkSync(file);
	} catch (error) {
		if (errorCode(error) !== 'ENOENT') throw error;
	}
}

function lockOwner(lockPath: string): number | undefined {
	let text;
	try {
		text = readFileSync(lockPath, 'utf8');
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined;
		throw error;
	}
	return /^[1-9]\d*$/.test(text) ? Number(text) : undefined;
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorCode(error) === 'EPERM';
	}
}

function errorCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}
