import { inspect } from 'node:util';
import * as Effect from 'effect/Effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCustomerBilling, type CustomerBillingRead } from './autumnRead';

/**
 * The real billing read against a stubbed `fetch`. The stubs behave like the
 * Fetch standard: a request settles or rejects when its signal aborts, and so
 * does reading a body that is still streaming. Whether the Convex runtime
 * honours the signal the same way is the local-backend check (B11), not this.
 */

const SECRET = 'am_sk_test_read';
/** Provider text that must never leave the read. */
const SENTINEL = 'PROVIDER-SENTINEL-7f3a';
const BUDGET_MS = 8000;
const TIMED_OUT: CustomerBillingRead = { kind: 'retry', code: 'autumn_timeout' };

const read = (customerId: string) => Effect.runPromise(readCustomerBilling(customerId));

/** The read's result once the whole budget has passed on the fake clock. */
async function readAfterBudget(customerId = 'user_1') {
	const pending = read(customerId);
	await vi.advanceTimersByTimeAsync(BUDGET_MS);
	return pending;
}

/** Every console line the code under test wrote, one entry per call. */
function captureLogs() {
	const lines: string[] = [];
	for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
			lines.push(args.map((arg) => inspect(arg, { depth: 8 })).join(' '));
		});
	}
	return lines;
}

type FetchStub = (url: string, init: RequestInit) => Promise<Response>;
function stubFetch(stub: FetchStub) {
	const fetchMock = vi.fn(stub);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** Rejects like a fetch whose signal aborted, and never settles otherwise. */
function untilAborted(signal: AbortSignal | null | undefined): Promise<never> {
	return new Promise((_, reject) => {
		signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
}

/** A 200 whose body sends one chunk, then stalls until the request's signal aborts. */
function stallingBody(signal: AbortSignal | null | undefined): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(`{"products":[],"note":"${SENTINEL}`));
			signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
		}
	});
	return new Response(body, { status: 200 });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubEnv('AUTUMN_SECRET_KEY', SECRET);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('readCustomerBilling', () => {
	it('asks Autumn API 1.2 for the customer with invoices', async () => {
		const fetchMock = stubFetch(async () => Response.json({ products: [], invoices: [] }));

		const result = await read('user/1 ä');

		expect(result).toEqual({ kind: 'ok', data: { products: [], invoices: [] } });
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('https://api.useautumn.com/v1/customers/user%2F1%20%C3%A4?expand=invoices');
		expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${SECRET}`);
		expect(new Headers(init.headers).get('x-api-version')).toBe('1.2');
	});

	it('gives headers and body one 8 s budget together', async () => {
		stubFetch(
			(_, init) =>
				new Promise((resolve) => setTimeout(() => resolve(stallingBody(init.signal)), 5000))
		);
		let settled: CustomerBillingRead | undefined;
		void read('user_1').then((result) => (settled = result));

		await vi.advanceTimersByTimeAsync(BUDGET_MS - 1);
		expect(settled).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toEqual(TIMED_OUT);
	});

	it('aborts the request of a refused response before returning', async () => {
		const fetchMock = stubFetch(async () => new Response(new ReadableStream(), { status: 503 }));

		expect(await read('user_1')).toEqual({ kind: 'retry', code: 'autumn_unavailable' });
		expect(fetchMock.mock.calls[0]![1].signal?.aborted).toBe(true);
	});

	it('aborts the request once when refused headers arrive after the deadline', async () => {
		let repeatedAborts = 0;
		class CountingAbortController extends AbortController {
			override abort(reason?: unknown) {
				if (this.signal.aborted) repeatedAborts += 1;
				super.abort(reason);
			}
		}
		vi.stubGlobal('AbortController', CountingAbortController);
		stubFetch(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve(new Response(null, { status: 401 })), BUDGET_MS + 1000)
				)
		);

		expect(await readAfterBudget()).toEqual(TIMED_OUT);
		await vi.advanceTimersByTimeAsync(1000);
		expect(repeatedAborts).toBe(0);
	});

	it.each<[string, number, CustomerBillingRead]>([
		['missing customer', 404, { kind: 'not_found' }],
		['not ready', 202, { kind: 'retry', code: 'autumn_not_ready' }],
		['rate limit', 429, { kind: 'retry', code: 'autumn_rate_limited' }],
		['request timeout', 408, { kind: 'retry', code: 'autumn_unavailable' }],
		['server error', 500, { kind: 'retry', code: 'autumn_unavailable' }],
		['bad gateway', 502, { kind: 'retry', code: 'autumn_unavailable' }],
		['unauthorized', 401, { kind: 'failed', code: 'autumn_auth' }],
		['forbidden', 403, { kind: 'failed', code: 'autumn_auth' }],
		['teapot', 418, { kind: 'failed', code: 'autumn_unexpected_status' }],
		['bad request', 400, { kind: 'failed', code: 'autumn_unexpected_status' }]
	])('classifies a %s (%i)', async (_, status, expected) => {
		stubFetch(async () => Response.json({ message: SENTINEL }, { status }));

		expect(await read('user_1')).toEqual(expected);
	});

	it.each([
		['malformed', `{"products": [${SENTINEL}`],
		['truncated', `{"products":[],"invoices":[{"total":10,"note":"${SENTINEL}`],
		['empty', ''],
		['HTML', `<html>${SENTINEL}</html>`]
	])('retries a 2xx with a %s body', async (_, body) => {
		stubFetch(async () => new Response(body, { status: 200 }));

		expect(await read('user_1')).toEqual({
			kind: 'retry',
			code: 'autumn_bad_response'
		});
	});

	it('retries a request that rejects', async () => {
		const fetchMock = stubFetch(async () => {
			throw new TypeError(`fetch failed: ${SENTINEL}`);
		});

		expect(await read('user_1')).toEqual({
			kind: 'retry',
			code: 'autumn_network'
		});
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('times out a request whose headers never arrive', { timeout: 2000 }, async () => {
		const fetchMock = stubFetch((_, init) => untilAborted(init.signal));

		expect(await readAfterBudget()).toEqual(TIMED_OUT);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[1].signal?.aborted).toBe(true);
	});

	it('times out a body that stalls after the headers', { timeout: 2000 }, async () => {
		const fetchMock = stubFetch(async (_, init) => stallingBody(init.signal));

		expect(await readAfterBudget()).toEqual(TIMED_OUT);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('reports missing billing configuration without calling Autumn', async () => {
		vi.stubEnv('AUTUMN_SECRET_KEY', '');
		const fetchMock = stubFetch(async () => Response.json({}));

		expect(await read('user_1')).toEqual({
			kind: 'failed',
			code: 'billing_unconfigured'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps provider text out of every result and log, and never throws', async () => {
		const logs = captureLogs();
		const responses: FetchStub[] = [
			...[404, 202, 429, 408, 503, 401, 403, 418].map(
				(status): FetchStub =>
					async () =>
						new Response(`{"error":"${SENTINEL}"}`, { status, statusText: SENTINEL })
			),
			async () => new Response(`{"broken":"${SENTINEL}`, { status: 200 }),
			async () => {
				throw new Error(SENTINEL);
			},
			(_, init) => untilAborted(init.signal),
			async (_, init) => stallingBody(init.signal)
		];

		const results: unknown[] = [];
		for (const respond of responses) {
			stubFetch(respond);
			results.push(await readAfterBudget());
		}

		expect(results).toHaveLength(responses.length);
		expect(JSON.stringify(results)).not.toContain(SENTINEL);
		expect(logs.join('\n')).not.toContain(SENTINEL);
	});
});
