/// <reference lib="webworker" />
/** A prose worker that exits without posting anything. In a Bun worker, this ends the worker. */
declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', () => process.exit(0));
