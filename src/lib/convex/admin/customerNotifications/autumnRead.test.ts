import { inspect } from 'node:util';
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
const ABORT_AFTER_MS = 30;

const realTimeout = AbortSignal.timeout.bind(AbortSignal);
let requestedTimeouts: number[] = [];

/** Every console line the code under test wrote, as one string. */
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
	vi.stubEnv('AUTUMN_SECRET_KEY', SECRET);
	requestedTimeouts = [];
	vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
		requestedTimeouts.push(ms);
		return realTimeout(ABORT_AFTER_MS);
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('readCustomerBilling', () => {
	it('asks Autumn API 1.2 for the customer with invoices, under one 8 s signal', async () => {
		const fetchMock = stubFetch(async () => Response.json({ products: [], invoices: [] }));

		const result = await readCustomerBilling('user/1 ä');

		expect(result).toEqual({ kind: 'ok', data: { products: [], invoices: [] } });
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('https://api.useautumn.com/v1/customers/user%2F1%20%C3%A4?expand=invoices');
		expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${SECRET}`);
		expect(new Headers(init.headers).get('x-api-version')).toBe('1.2');
		expect(requestedTimeouts).toEqual([8000]);
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

		expect(await readCustomerBilling('user_1')).toEqual(expected);
	});

	it.each([
		['malformed', `{"products": [${SENTINEL}`],
		['truncated', `{"products":[],"invoices":[{"total":10,"note":"${SENTINEL}`],
		['empty', ''],
		['HTML', `<html>${SENTINEL}</html>`]
	])('retries a 2xx with a %s body', async (_, body) => {
		stubFetch(async () => new Response(body, { status: 200 }));

		expect(await readCustomerBilling('user_1')).toEqual({
			kind: 'retry',
			code: 'autumn_bad_response'
		});
	});

	it('retries a request that rejects', async () => {
		stubFetch(async () => {
			throw new TypeError(`fetch failed: ${SENTINEL}`);
		});

		expect(await readCustomerBilling('user_1')).toEqual({
			kind: 'retry',
			code: 'autumn_network'
		});
	});

	// Without the signal the stub never settles, and this test times out.
	it('times out a request whose headers never arrive', { timeout: 2000 }, async () => {
		stubFetch((_, init) => untilAborted(init.signal));

		expect(await readCustomerBilling('user_1')).toEqual({
			kind: 'retry',
			code: 'autumn_timeout'
		});
	});

	it('times out a body that stalls after the headers', { timeout: 2000 }, async () => {
		stubFetch(async (_, init) => stallingBody(init.signal));

		expect(await readCustomerBilling('user_1')).toEqual({
			kind: 'retry',
			code: 'autumn_timeout'
		});
	});

	it('reports missing billing configuration without calling Autumn', async () => {
		vi.stubEnv('AUTUMN_SECRET_KEY', '');
		const fetchMock = stubFetch(async () => Response.json({}));

		expect(await readCustomerBilling('user_1')).toEqual({
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
			results.push(await readCustomerBilling('user_1'));
		}

		expect(results).toHaveLength(responses.length);
		expect(JSON.stringify(results)).not.toContain(SENTINEL);
		expect(logs.join('\n')).not.toContain(SENTINEL);
	});
});
