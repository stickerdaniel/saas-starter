/// <reference lib="webworker" />
/** Worker entry for `startProseWorkers`: posts each file's outcome, then `done`. */
import { checkProseFile, type ProseJob, type ProseMessage } from './workers';

declare const self: DedicatedWorkerGlobalScope;

const post = (message: ProseMessage): void => self.postMessage(message);

self.addEventListener('message', async (event: MessageEvent<ProseJob>) => {
	const { directory, shard } = event.data;
	for (const [index, file, kind] of shard) post(await checkProseFile(index, file, kind, directory));
	post({ done: true });
});
