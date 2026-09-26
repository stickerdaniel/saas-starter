// Node entry for scripts/csp-hashes.ts: renders one page from the emitted
// SvelteKit server and writes the response to a JSON file. It is a separate
// Node process because the build runs under Bun, which stringifies mode-watcher's
// script differently, and because the rendered app leaves client timers alive.
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const [serverDirectory, pageUrl, resultFile] = process.argv.slice(2);

// Only markup is read. Backend reads fail and the Convex client's socket never
// opens, so verifying a build cannot reach the deployment it targets.
globalThis.fetch = async () => {
	throw new Error('Network access is disabled while verifying CSP hashes.');
};
globalThis.WebSocket = class {
	addEventListener() {}
	removeEventListener() {}
	send() {}
	close() {}
};

const load = (file) => import(pathToFileURL(path.join(serverDirectory, file)).href);
const [{ Server }, { manifest }] = await Promise.all([load('index.js'), load('manifest.js')]);
const server = new Server(manifest);
await server.init({ env: process.env });
const response = await server.respond(new Request(pageUrl), {
	getClientAddress: () => '127.0.0.1'
});
writeFileSync(
	resultFile,
	JSON.stringify({
		status: response.status,
		contentType: response.headers.get('content-type'),
		html: await response.text()
	})
);
// The result is on disk; exit instead of waiting for the app's timers.
process.exit(0);
