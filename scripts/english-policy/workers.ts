/**
 * The English prose check spread over Bun workers. Each worker checks a round-robin shard of
 * the files and posts one outcome per file as it finishes it; `findings()` turns those into
 * what the inline loop over the same files returns or throws.
 */
import path from 'node:path';
import { checkEnglishText, type EnglishFinding, type ProseKind } from './content';

/** A file the prose check reads, with the kind of prose the caller determined for it. */
export type ProseFile = readonly [file: string, kind: ProseKind];

/** The files a worker checks, each with its position in the full list. */
export type ProseShard = Array<[index: number, file: string, kind: ProseKind]>;

/** What a worker receives: its shard, and the directory the shard's file names are relative to. */
export interface ProseJob {
	readonly directory: string;
	readonly shard: ProseShard;
}

export type ProseOutcome = { index: number } & ({ findings: EnglishFinding[] } | { error: string });

/** What a worker posts: one outcome per file of its shard, then `done`. */
export type ProseMessage = ProseOutcome | { done: true };

/**
 * Read a file once, relative to `directory`, and check it as `kind` under its given name,
 * recording a thrown error as the file's outcome.
 */
export async function checkProseFile(
	index: number,
	file: string,
	kind: ProseKind,
	directory: string
): Promise<ProseOutcome> {
	try {
		const text = await Bun.file(path.resolve(directory, file)).text();
		return { index, findings: checkEnglishText(file, text, kind) };
	} catch (error) {
		return { index, error: error instanceof Error ? error.message : String(error) };
	}
}

function runShard(
	entry: URL,
	job: ProseJob,
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
		worker.postMessage(job);
	});
}

/**
 * Start checking `files`, named relative to `directory`, on up to `count` workers. A worker
 * that fails to load, throws or closes before it is done stops the others; `findings()` keeps
 * every outcome already received and checks only the remaining files itself. Workers end once
 * done, after a failure, and when this process exits.
 */
export function startProseWorkers(
	files: readonly ProseFile[],
	count: number,
	directory: string,
	entry = new URL('./worker.ts', import.meta.url)
): { findings(): Promise<EnglishFinding[]> } {
	const shards: ProseShard[] = Array.from({ length: Math.min(count, files.length) }, () => []);
	files.forEach(([file, kind], index) => shards[index % shards.length]!.push([index, file, kind]));
	const started: Worker[] = [];
	const terminate = (): void => {
		for (const worker of started) worker.terminate();
	};
	process.once('exit', terminate);
	const outcomes = new Map<number, ProseOutcome>();
	const settled = Promise.all(
		shards.map((shard) => runShard(entry, { directory, shard }, started, outcomes))
	)
		.catch(() => undefined)
		.finally(terminate);

	return {
		async findings() {
			await settled;
			// The inline loop throws at the first failing file and returns no findings.
			const findings: EnglishFinding[] = [];
			for (const [index, [file, kind]] of files.entries()) {
				const outcome = outcomes.get(index) ?? (await checkProseFile(index, file, kind, directory));
				if ('error' in outcome) throw new Error(outcome.error);
				findings.push(...outcome.findings);
			}
			return findings;
		}
	};
}
