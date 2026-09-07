// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForBackendReady } from '../e2e/utils/backend-readiness';

// Captured from a real local Convex 1.42.1 backend via POST /api/query for
// tests:health. Both envelopes arrived with HTTP 200, so the error shape is the
// actual UDF shape rather than a reconstructed assumption.
const HEALTH_READY_ENVELOPE = { status: 'success', value: { ok: true } };
const UNAUTHORIZED_ENVELOPE = {
	status: 'error',
	errorMessage:
		'[Request ID: cb3118f2c52765d7] Server Error\nUncaught Error: Unauthorized: Invalid test secret\n' +
		'    at requireTestSecret (../src/lib/convex/tests.ts:16:0)\n' +
		'    at handler (../src/lib/convex/tests.ts:35:1)\n'
};

const SECRET = 'test-secret';
// Headroom over the configured deadline for client and server work. Anything
// above this means the deadline is not what ended the wait.
const RUNTIME_BUDGET_MS = 3000;

interface TestBackend {
	url: string;
	requestCount: () => number;
	/** Resolves when the server sees the client end a still-open response. */
	clientDisconnected: Promise<void>;
	close: () => Promise<void>;
}

const backends: TestBackend[] = [];

async function startBackend(
	handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<TestBackend> {
	let requestCount = 0;
	const sockets = new Set<Socket>();
	let markDisconnected: () => void;
	const clientDisconnected = new Promise<void>((resolve) => {
		markDisconnected = resolve;
	});

	const server = createServer((request, response) => {
		requestCount += 1;
		// 'close' also fires after a complete response, so only count the case
		// where the connection drops before the response ends.
		response.on('close', () => {
			if (!response.writableFinished) markDisconnected();
		});
		handler(request, response);
	});
	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.on('close', () => sockets.delete(socket));
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;

	const backend: TestBackend = {
		url: `http://127.0.0.1:${port}`,
		requestCount: () => requestCount,
		clientDisconnected,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	};
	backends.push(backend);
	return backend;
}

function respondJson(response: ServerResponse, body: unknown): void {
	const payload = JSON.stringify(body);
	response.writeHead(200, {
		'content-type': 'application/json',
		'content-length': Buffer.byteLength(payload)
	});
	response.end(payload);
}

afterEach(async () => {
	while (backends.length > 0) await backends.pop()!.close();
});

describe('waitForBackendReady deadline', { timeout: 20_000 }, () => {
	it('ends the wait when the backend accepts the connection and never answers', async () => {
		// Deliberately leave the request unanswered: without a deadline, the client
		// waits forever.
		const backend = await startBackend(() => {});

		const started = Date.now();
		await expect(
			waitForBackendReady(backend.url, SECRET, { timeoutMs: 300, pollIntervalMs: 50 })
		).rejects.toThrow('Test backend never reported ready (api.tests.health) within 300ms');
		expect(Date.now() - started).toBeLessThan(300 + RUNTIME_BUDGET_MS);

		// Before our own cleanup, the client must initiate the abort.
		await backend.clientDisconnected;
	});

	it('ends the wait when headers are flushed and the response body stays open', async () => {
		const backend = await startBackend((_request, response) => {
			response.writeHead(200, { 'content-type': 'application/json' });
			// Incomplete JSON: the response has started and never finishes, so the
			// hang occurs while the client reads the body after sending the request.
			response.write('{"status":"suc');
		});

		const started = Date.now();
		await expect(
			waitForBackendReady(backend.url, SECRET, { timeoutMs: 300, pollIntervalMs: 50 })
		).rejects.toThrow('Test backend never reported ready (api.tests.health) within 300ms');
		expect(Date.now() - started).toBeLessThan(300 + RUNTIME_BUDGET_MS);

		await backend.clientDisconnected;
	});

	it('ends the polling pause instead of waiting out the interval', async () => {
		// The first query fails transiently; the subsequent pause would run far
		// past the deadline.
		const backend = await startBackend((request) => request.socket.destroy());

		const started = Date.now();
		await expect(
			waitForBackendReady(backend.url, SECRET, { timeoutMs: 400, pollIntervalMs: 30_000 })
		).rejects.toThrow('Test backend never reported ready (api.tests.health) within 400ms');

		const elapsed = Date.now() - started;
		expect(elapsed).toBeLessThan(400 + RUNTIME_BUDGET_MS);
		expect(elapsed).toBeLessThan(30_000);
		expect(backend.requestCount()).toBe(1);
	});

	it('returns after a single query once the backend reports ready', async () => {
		const backend = await startBackend((_request, response) =>
			respondJson(response, HEALTH_READY_ENVELOPE)
		);

		await expect(
			waitForBackendReady(backend.url, SECRET, { timeoutMs: 5000, pollIntervalMs: 50 })
		).resolves.toBeUndefined();
		expect(backend.requestCount()).toBe(1);
	});

	it('retries a transient network failure and then succeeds', async () => {
		let attempts = 0;
		const backend = await startBackend((request, response) => {
			attempts += 1;
			if (attempts === 1) {
				request.socket.destroy();
				return;
			}
			respondJson(response, HEALTH_READY_ENVELOPE);
		});

		await expect(
			waitForBackendReady(backend.url, SECRET, { timeoutMs: 5000, pollIntervalMs: 50 })
		).resolves.toBeUndefined();
		expect(backend.requestCount()).toBe(2);
	});

	it('fails fast when the backend rejects the test secret', async () => {
		const backend = await startBackend((_request, response) =>
			respondJson(response, UNAUTHORIZED_ENVELOPE)
		);

		await expect(
			waitForBackendReady(backend.url, SECRET, { timeoutMs: 5000, pollIntervalMs: 50 })
		).rejects.toThrow('Test backend rejected AUTH_E2E_TEST_SECRET');
		expect(backend.requestCount()).toBe(1);
	});
});
