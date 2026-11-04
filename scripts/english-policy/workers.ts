/**
 * The English prose check spread over Bun workers. Each worker checks a round-robin shard of
 * the files and posts one outcome per file as it finishes it; `findings()` turns those into
 * what the inline loop over the same files returns or throws.
 */
import { checkEnglishText, type EnglishFinding } from './content';

/** The files a worker checks, each with its position in the full list. */
export type ProseShard = Array<[index: number, file: string]>;

export type ProseOutcome = { index: number } & ({ findings: EnglishFinding[] } | { error: string });

/** What a worker posts: one outcome per file of its shard, then `done`. */
export type ProseMessage = ProseOutcome | { done: true };

/** Read a file once and check it, recording a thrown error as the file's outcome. */
export async function checkProseFile(index: number, file: string): Promise<ProseOutcome> {
	try {
		return { index, findings: checkEnglishText(file, await Bun.file(file).text()) };
	} catch (error) {
		return { index, error: error instanceof Error ? error.message : String(error) };
	}
}

function runShard(
	entry: URL,
	shard: ProseShard,
	started: Worker[],
	outcomes: Map<number, ProseOutcome>
): Promise<void> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(entry.href);
		started.push(worker);
		worker.addEventListener('message', (event: MessageEvent<ProseMessage>) => {
			if ('done' in event.data) {
				resolve();
				worker.terminate();
			} else outcomes.set(event.data.index, event.data);
		});
		worker.addEventListener('error', (event) => {
			// Handled here, so Bun does not also print the worker's error.
			event.preventDefault();
			reject(new Error(event.message));
		});
		// Also fires after the terminate above, when the promise has already settled.
		worker.addEventListener('close', () => reject(new Error('Worker closed before it was done')));
		worker.postMessage(shard);
	});
}

/**
 * Start checking `files` on up to `count` workers. A worker that fails to load, throws or
 * closes before it is done stops the others; `findings()` keeps every outcome already
 * received and checks only the remaining files itself. Workers end once done, after a
 * failure, and when this process exits.
 */
export function startProseWorkers(
	files: string[],
	count: number,
	entry = new URL('./worker.ts', import.meta.url)
): { findings(): Promise<EnglishFinding[]> } {
	const shards: ProseShard[] = Array.from({ length: Math.min(count, files.length) }, () => []);
	files.forEach((file, index) => shards[index % shards.length]!.push([index, file]));
	const started: Worker[] = [];
	const terminate = (): void => {
		for (const worker of started) worker.terminate();
	};
	process.once('exit', terminate);
	const outcomes = new Map<number, ProseOutcome>();
	const settled = Promise.all(shards.map((shard) => runShard(entry, shard, started, outcomes)))
		.catch(() => undefined)
		.finally(terminate);

	return {
		async findings() {
			await settled;
			// The inline loop throws at the first failing file and returns no findings.
			const findings: EnglishFinding[] = [];
			for (const [index, file] of files.entries()) {
				const outcome = outcomes.get(index) ?? (await checkProseFile(index, file));
				if ('error' in outcome) throw new Error(outcome.error);
				findings.push(...outcome.findings);
			}
			return findings;
		}
	};
}
