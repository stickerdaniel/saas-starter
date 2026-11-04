/// <reference lib="webworker" />
/**
 * A prose worker pair in which the shard holding file 0 reports a read error for it, as a
 * one-off I/O failure would, and the other shard closes before it is done once that error
 * is out. Reading file 0 again would succeed. Both share PROSE_WORKER_GATE.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { checkProseFile, type ProseMessage, type ProseShard } from '../../english-policy/workers';

declare const self: DedicatedWorkerGlobalScope;

const gate = process.env.PROSE_WORKER_GATE!;
const post = (message: ProseMessage): void => self.postMessage(message);

self.addEventListener('message', async (event: MessageEvent<ProseShard>) => {
	if (event.data[0]?.[0] === 0) {
		post({ index: 0, error: 'Transient read failure for the first prose file' });
		writeFileSync(gate, '');
		for (const [index, file] of event.data.slice(1)) post(await checkProseFile(index, file));
		post({ done: true });
		return;
	}
	const deadline = Date.now() + 10_000;
	while (!existsSync(gate) && Date.now() < deadline) await Bun.sleep(10);
	process.exit(0);
});
