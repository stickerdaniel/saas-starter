/// <reference lib="webworker" />
/**
 * The real prose worker, except that the shard holding file 0 starts posting only after the
 * other shard is done, so outcomes arrive out of file order. Both share PROSE_WORKER_GATE.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { checkProseFile, type ProseMessage, type ProseShard } from '../../english-policy/workers';

declare const self: DedicatedWorkerGlobalScope;

const gate = process.env.PROSE_WORKER_GATE!;
const post = (message: ProseMessage): void => self.postMessage(message);

self.addEventListener('message', async (event: MessageEvent<ProseShard>) => {
	const first = event.data.some(([index]) => index === 0);
	const deadline = Date.now() + 10_000;
	while (first && !existsSync(gate) && Date.now() < deadline) await Bun.sleep(10);
	for (const [index, file] of event.data) post(await checkProseFile(index, file));
	post({ done: true });
	if (!first) writeFileSync(gate, '');
});
