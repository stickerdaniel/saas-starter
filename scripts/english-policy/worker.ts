/// <reference lib="webworker" />
/** Worker entry for `startProseWorkers`: posts each file's outcome, then `done`. */
import { checkProseFile, type ProseMessage, type ProseShard } from './workers';

declare const self: DedicatedWorkerGlobalScope;

const post = (message: ProseMessage): void => self.postMessage(message);

self.addEventListener('message', async (event: MessageEvent<ProseShard>) => {
	for (const [index, file] of event.data) post(await checkProseFile(index, file));
	post({ done: true });
});
