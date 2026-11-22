import { spawnSync } from 'node:child_process';
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
import { setTimeout as delay } from 'node:timers/promises';

const POLL_MS = 50;
const HOLDER_CHECK_MS = 1_000;
const UNWRITTEN_OWNER_ABANDONED_MS = 10_000;
const RECLAIM_ABANDONED_MS = 10_000;
const DEFERRED_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

type CheckoutLockOwner = { pid: number; incarnation: string };

type CheckoutLockOptions = {
	onWait?: () => void;
	signal?: AbortSignal;
};

export function checkoutLockPath(root: string): string {
	const checkout = realpathSync.native(root);
	const key = createHash('sha256').update(checkout).digest('hex').slice(0, 16);
	return path.join(tmpdir(), `checkout-lock-${key}.lock`);
}

export async function withCheckoutLock<T>(
	root: string,
	run: () => Promise<T> | T,
	{ onWait, signal }: CheckoutLockOptions = {}
): Promise<T> {
	signal?.throwIfAborted();
	const lockPath = checkoutLockPath(root);
	let release = tryAcquire(lockPath);
	let checkedAt = 0;
	if (!release) onWait?.();
	while (!release) {
		if (Date.now() - checkedAt >= HOLDER_CHECK_MS) {
			checkedAt = Date.now();
			removeIfAbandoned(lockPath);
			release = tryAcquire(lockPath);
			if (release) break;
		}
		await delay(POLL_MS, undefined, { signal }).catch(() => signal?.throwIfAborted());
		release = tryAcquire(lockPath);
	}
	try {
		return await run();
	} finally {
		release();
	}
}

function processIncarnation(pid: number): string | undefined {
	if (process.platform === 'linux') return linuxStartTicks(pid);
	const command =
		process.platform === 'win32'
			? {
					file: 'powershell.exe',
					args: [
						'-NoProfile',
						'-NonInteractive',
						'-Command',
						`(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`
					]
				}
			: { file: 'ps', args: ['-o', 'lstart=', '-p', String(pid)] };
	const result = spawnSync(command.file, command.args, {
		encoding: 'utf8',
		env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
		stdio: ['ignore', 'pipe', 'ignore'],
		windowsHide: true
	});
	const incarnation = result.status === 0 ? result.stdout.trim() : '';
	return incarnation === '' ? undefined : incarnation;
}

function linuxStartTicks(pid: number): string | undefined {
	let stat: string;
	try {
		stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
	} catch {
		return undefined;
	}
	return stat
		.slice(stat.lastIndexOf(')') + 2)
		.split(' ')
		.at(19);
}

let ownIncarnation: string | undefined;

function ownOwner(): CheckoutLockOwner {
	ownIncarnation ??= processIncarnation(process.pid) ?? '';
	return { pid: process.pid, incarnation: ownIncarnation };
}

function tryAcquire(lockPath: string): (() => void) | undefined {
	const owner = ownOwner();
	let descriptor: number;
	try {
		descriptor = openSync(lockPath, 'wx');
	} catch (error) {
		if (errorCode(error) !== 'EEXIST') throw error;
		return undefined;
	}
	try {
		writeSync(descriptor, JSON.stringify(owner));
	} finally {
		closeSync(descriptor);
	}
	let received: NodeJS.Signals | undefined;
	const onSignal = (signal: NodeJS.Signals) => {
		received ??= signal;
	};
	const release = () => {
		process.off('exit', release);
		for (const signal of DEFERRED_SIGNALS) process.off(signal, onSignal);
		removeOwnLock(lockPath, owner);
		if (received && process.listenerCount(received) === 0) process.kill(process.pid, received);
	};
	process.on('exit', release);
	for (const signal of DEFERRED_SIGNALS) process.on(signal, onSignal);
	return release;
}

function removeOwnLock(lockPath: string, owner: CheckoutLockOwner): void {
	try {
		const current = lockOwner(lockPath);
		if (current?.pid === owner.pid && current.incarnation === owner.incarnation) {
			unlinkSync(lockPath);
		}
	} catch {
		return;
	}
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
	if (!isRunning(owner.pid)) return true;
	if (owner.incarnation === '') return false;
	const live = processIncarnation(owner.pid);
	return live !== undefined && live !== owner.incarnation;
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

function lockOwner(lockPath: string): CheckoutLockOwner | undefined {
	let text;
	try {
		text = readFileSync(lockPath, 'utf8');
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return undefined;
		throw error;
	}
	if (/^[1-9]\d*$/.test(text)) return { pid: Number(text), incarnation: '' };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		!('pid' in parsed) ||
		!('incarnation' in parsed) ||
		typeof parsed.pid !== 'number' ||
		!Number.isSafeInteger(parsed.pid) ||
		parsed.pid < 1 ||
		typeof parsed.incarnation !== 'string'
	) {
		return undefined;
	}
	return { pid: parsed.pid, incarnation: parsed.incarnation };
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
