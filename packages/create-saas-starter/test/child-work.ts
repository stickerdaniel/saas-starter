import type { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';

const unsettled = new Set<Promise<unknown>>();

/**
 * Tracks test work that owns real child processes. A Vitest timeout abandons the test body
 * but not its children, so callers stop the work from the test's abort signal and `afterEach`
 * awaits `settleChildWork()` before it restores mocks or deletes the children's directories.
 */
export function childWork<T>(work: Promise<T>): Promise<T> {
	unsettled.add(work);
	const forget = () => unsettled.delete(work);
	work.then(forget, forget);
	return work;
}

export async function settleChildWork(): Promise<void> {
	await Promise.allSettled(unsettled);
}

/** Stops a CLI run on test timeout the way a user would, so it kills its children. */
export function interruptOnAbort(signal: AbortSignal, interrupts: EventEmitter): void {
	signal.addEventListener('abort', () => interrupts.emit('SIGINT'), { once: true });
}

/** Windows releases a stopped child's working directory shortly after the child exits. */
export async function removeDirectories(directories: string[]): Promise<void> {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, maxRetries: 10 }))
	);
}
