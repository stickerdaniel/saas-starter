import type { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';

const unsettled = new Set<Promise<unknown>>();

/**
 * Starts test work that owns real child processes. A Vitest timeout aborts the test's `signal`
 * and abandons the test body, but not its children, so the work:
 * - never starts once `signal` has aborted, even when the abandoned body resumes later;
 * - is tracked in the same synchronous step that starts it, so `afterEach` can await
 *   `settleChildWork()` before it restores mocks or deletes the children's directories.
 * `start` must stop its children when `signal` aborts.
 */
export function childWork<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
	const work = signal.aborted ? Promise.reject(signal.reason) : start();
	unsettled.add(work);
	const forget = () => unsettled.delete(work);
	work.then(forget, forget);
	return work;
}

/** Starts a CLI run as child work; a test timeout reaches it as the SIGINT a user would send. */
export function cliChildWork(
	signal: AbortSignal,
	interrupts: EventEmitter,
	start: () => Promise<number>
): Promise<number> {
	return childWork(signal, () => {
		// runCli installs its SIGINT listener before its first await, so it hears this abort.
		const running = start();
		signal.addEventListener('abort', () => interrupts.emit('SIGINT'), { once: true });
		return running;
	});
}

export async function settleChildWork(): Promise<void> {
	await Promise.allSettled(unsettled);
}

/** Windows releases a stopped child's working directory shortly after the child exits. */
export async function removeDirectories(directories: string[]): Promise<void> {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, maxRetries: 10 }))
	);
}
