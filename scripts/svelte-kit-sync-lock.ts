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

/*
 * Every `svelte-kit sync` deletes the root route's generated types and writes them again,
 * whether or not a route changed: its stale-file sweep compares `src/routes/` with
 * `src/routes` and never finds the root route expected (@sveltejs/kit 3.1.0, observed
 * 2026-11-02). A second sync in the same checkout that lists `.svelte-kit/types` while the
 * first one sweeps it can stat a file that is already gone and fail with ENOENT, which fails
 * parallel static-check runs, such as the tooling tests that start them. Syncs of one
 * checkout therefore take turns behind this lock. Separate checkouts have separate
 * `.svelte-kit` trees and separate locks.
 *
 * The deletion is sveltejs/kit#17465. A fix for it alone leaves the lock needed: concurrent
 * syncs can also read each other's half-written route_meta_data.json (sveltejs/kit#17095).
 */

/** How long a waiting process sleeps before it looks at the lock again. */
const POLL_MS = 50;

/**
 * A lock this old is abandoned even when its pid looks alive, which covers a pid the system
 * handed to a new process after the holder died. A sync takes seconds, so no real one ends.
 */
const ABANDONED_MS = 10 * 60_000;

/** A reclaim marker older than this was left by a waiter that died while reclaiming. */
const RECLAIM_ABANDONED_MS = 10_000;

/** The lock file shared by every sync of the checkout at `root`. */
export function svelteKitSyncLockPath(root: string): string {
	const checkout = realpathSync.native(root);
	const key = createHash('sha256').update(checkout).digest('hex').slice(0, 16);
	return path.join(tmpdir(), `svelte-kit-sync-${key}.lock`);
}

/**
 * Runs `run`, which starts a SvelteKit sync in `root`, while no other process syncs that
 * checkout. `onWait` is called once if another process holds the lock first.
 */
export async function withSvelteKitSyncLock<T>(
	root: string,
	run: () => Promise<T> | T,
	onWait?: () => void
): Promise<T> {
	const lockPath = svelteKitSyncLockPath(root);
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

/** `withSvelteKitSyncLock` for synchronous callers; it blocks the thread while it waits. */
export function withSvelteKitSyncLockSync<T>(root: string, run: () => T): T {
	const lockPath = svelteKitSyncLockPath(root);
	let release = tryAcquire(lockPath);
	while (!release) {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_MS);
		release = tryAcquire(lockPath);
	}
	try {
		return run();
	} finally {
		release();
	}
}

/** Creates the lock if no live process holds it, and returns its release. */
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
			// This can run in an exit handler, which must not throw. A lock left behind names
			// this pid, and the next process takes it over once this one has exited.
		}
	};
	// `run` may end the process with process.exit(), as a failed static-check command does,
	// and then no finally block runs.
	process.on('exit', release);
	return release;
}

/**
 * Removes the lock when its holder has exited or it has outlived any real sync.
 *
 * Two waiters can find the same abandoned lock. If both removed it, the second removal could
 * hit the fresh lock the first one created in between, and two syncs would run at once. A
 * waiter therefore reclaims only while it holds a second exclusive file, and judges the lock
 * again there.
 */
function removeIfAbandoned(lockPath: string): void {
	if (!isAbandoned(lockPath)) return;
	const reclaimPath = `${lockPath}.reclaim`;
	let descriptor: number;
	try {
		descriptor = openSync(reclaimPath, 'wx');
	} catch (error) {
		if (errorCode(error) !== 'EEXIST') throw error;
		// Another waiter is reclaiming. Its marker outlives those few lines only when that
		// waiter died or stopped inside them, and then it guards nothing.
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
	// An unreadable owner is a holder between creating the file and writing its pid.
	return (owner !== undefined && !isRunning(owner)) || age > ABANDONED_MS;
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
		// EPERM: the process exists and belongs to someone else.
		return errorCode(error) === 'EPERM';
	}
}

function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException | undefined)?.code;
}
