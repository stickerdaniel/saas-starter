import { inspect } from 'node:util';
import { Webhook } from 'svix';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJourneyStore } from '../journey/journeyStore.fixtures';
import { admitObservation } from './admission';
import { handleAutumnWebhook } from './observe';
import payingActiveCouponCard from './__fixtures__/autumn/paying-active-coupon-card.json';
import payingScheduledCancelLink from './__fixtures__/autumn/paying-scheduled-cancel-link.json';
import zeroTotalEndedA from './__fixtures__/autumn/zero-total-ended-a.json';

/**
 * POST /autumn-webhook through the real handler, billing read, normalizer and
 * admission, on the in-memory store. Deliveries are signed with svix's own
 * `Webhook.sign` and carry Svix's three headers. Autumn is a stubbed `fetch`
 * answering with the ported customer reads. The event payloads carry only the
 * fields this boundary reads; they are models, not captured Autumn events.
 */

type Registered = { _handler: (ctx: never, args: never) => Promise<unknown> };
type HttpHandler = { _handler: (ctx: unknown, request: Request) => Promise<Response> };

const SECRET = `whsec_${Buffer.from('template-autumn-webhook-test-key').toString('base64')}`;
const OTHER_SECRET = `whsec_${Buffer.from('somebody-elses-webhook-test-key').toString('base64')}`;
const CUSTOMER = 'user_ada';
const SIGNUP = Date.UTC(2026, 9, 1, 9);
/** After the fixtures' invoices (2026-10-05 and 2026-10-06). */
const NOW = Date.UTC(2026, 9, 7, 12);
/** Provider and payload text that must never leave the observer. */
const SENTINEL = 'PRIVATE-SENTINEL-c41d';
const ADMIT = 'admin/customerNotifications/admission:admitObservation';
const SEND = 'admin/customerNotifications/send:sendNewCustomer';
const PAID = payingActiveCouponCard.data.invoices[0]!;

function setup(functions: Record<string, Registered> = {}) {
	const store = createJourneyStore({
		users: [{ _id: CUSTOMER, name: 'Ada', email: 'ada@example.com', createdAt: SIGNUP }],
		functions: { [ADMIT]: admitObservation as unknown as Registered, ...functions }
	});
	/** Deliver one request to the handler, the way the HTTP router would. */
	const deliver = (request: Request) =>
		(handleAutumnWebhook as unknown as HttpHandler)._handler(store.actionCtx(), request);
	const rows = () => store.docs('customerNotifications');
	return { store, deliver, rows };
}

/** A delivery as Svix sends it: the raw body and the three headers signed over it. */
function delivery(
	body: string,
	options: { secret?: string; id?: string; at?: Date; omit?: string } = {}
) {
	const { secret = SECRET, id = `msg_${crypto.randomUUID()}`, at = new Date() } = options;
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'svix-id': id,
		'svix-timestamp': String(Math.floor(at.getTime() / 1000)),
		'svix-signature': new Webhook(secret).sign(id, at, body)
	};
	if (options.omit) delete headers[options.omit];
	return new Request('https://example.convex.site/autumn-webhook', {
		method: 'POST',
		headers,
		body
	});
}

const billingUpdated = (customerId: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({ type: 'billing.updated', data: { customer_id: customerId, ...extra } });
const productsUpdated = (customerId: string) =>
	JSON.stringify({ type: 'customer.products.updated', data: { customer: { id: customerId } } });

/** Answer every Autumn read with these responses in turn; the last one repeats. */
function stubAutumn(...responses: Array<() => Response | Promise<Response>>) {
	let call = 0;
	const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
		const respond = responses[Math.min(call++, responses.length - 1)]!;
		return await respond();
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}
const json =
	(data: unknown, status = 200) =>
	() =>
		Response.json(data, { status });

/** Every console line the code under test wrote, as one string. */
function captureLogs() {
	const lines: string[] = [];
	for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
			lines.push(args.map((arg) => inspect(arg, { depth: 8 })).join(' '));
		});
	}
	return { text: () => lines.join('\n'), lines };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	vi.stubEnv('AUTUMN_WEBHOOK_SECRET', SECRET);
	vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_webhook');
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('signature verification', () => {
	it('accepts the exact signed bytes and rejects the same event re-serialized', async () => {
		const { deliver } = setup();
		stubAutumn(json(zeroTotalEndedA.data));
		// Whitespace Autumn might send; parsing and re-serializing drops it.
		const raw = `{ "type": "billing.updated", "data": { "customer_id": "${CUSTOMER}" } }`;
		const signed = delivery(raw);
		const reserialized = new Request(signed.url, {
			method: 'POST',
			headers: signed.headers,
			body: JSON.stringify(JSON.parse(raw))
		});

		expect((await deliver(delivery(raw))).status).toBe(200);
		expect((await deliver(reserialized)).status).toBe(401);
	});

	it.each([
		['another secret', { secret: OTHER_SECRET }],
		['no svix-id', { omit: 'svix-id' }],
		['no svix-timestamp', { omit: 'svix-timestamp' }],
		['no svix-signature', { omit: 'svix-signature' }],
		['a timestamp outside the tolerance', { at: new Date(NOW - 10 * 60_000) }]
	])('rejects a delivery signed with %s, silently', async (_, options) => {
		const logs = captureLogs();
		const { deliver, rows } = setup();
		const fetchMock = stubAutumn(json(payingActiveCouponCard.data));

		const response = await deliver(delivery(billingUpdated(CUSTOMER), options));

		expect(response.status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(rows()).toEqual([]);
		expect(logs.lines).toEqual([]);
	});

	it.each([
		['unset', undefined],
		['not a Svix signing secret', 'whsec_not base64!']
	])('answers 503 while the secret is %s', async (_, secret) => {
		const logs = captureLogs();
		vi.stubEnv('AUTUMN_WEBHOOK_SECRET', secret);
		const { deliver } = setup();
		const fetchMock = stubAutumn(json(payingActiveCouponCard.data));

		const response = await deliver(delivery(billingUpdated(CUSTOMER)));

		expect(response.status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(logs.text()).toContain('webhook_not_configured');
	});
});

describe('response table', () => {
	it.each([
		['billing.updated', billingUpdated(CUSTOMER)],
		['customer.products.updated', productsUpdated(CUSTOMER)],
		[
			'billing.updated naming the customer in both slots',
			billingUpdated(CUSTOMER, { customer: { id: CUSTOMER } })
		]
	])('admits the first payment from %s', async (_, body) => {
		const logs = captureLogs();
		const { store, deliver, rows } = setup();
		const fetchMock = stubAutumn(json(payingActiveCouponCard.data));

		const response = await deliver(delivery(body));

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('');
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			`https://api.useautumn.com/v1/customers/${CUSTOMER}?expand=invoices`
		);
		expect(rows()).toEqual([
			expect.objectContaining({
				userId: CUSTOMER,
				kind: 'new_customer',
				episodeKey: CUSTOMER,
				status: 'scheduled',
				billing: {
					firstPayment: {
						invoiceAt: PAID.created_at,
						total: PAID.total,
						currency: 'eur',
						planId: 'pro',
						interval: 'month'
					},
					current: { planId: 'pro', interval: 'month' }
				},
				request: {
					episode: 'new_customer',
					userId: CUSTOMER,
					signupAt: SIGNUP,
					paymentAt: PAID.created_at,
					window: { start: SIGNUP, end: PAID.created_at }
				},
				observedAt: NOW,
				sendAt: NOW
			})
		]);
		const [row] = rows();
		expect(store.scheduled()).toEqual([{ id: row!.scheduledFnId, name: SEND, state: 'pending' }]);
		expect(store.jobs()).toEqual([{ delayMs: 0, name: SEND, args: { notificationId: row!._id } }]);
		expect(logs.lines).toEqual([]);
	});

	it('acknowledges an unsupported event type without reading Autumn', async () => {
		const logs = captureLogs();
		const { deliver } = setup();
		const fetchMock = stubAutumn(json(payingActiveCouponCard.data));

		const response = await deliver(
			delivery(
				JSON.stringify({ type: 'customer.threshold_reached', data: { customer_id: CUSTOMER } })
			)
		);

		expect(response.status).toBe(200);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(logs.lines).toEqual([]);
	});

	it.each([
		['a body that is not JSON', `{"type":"billing.updated",`],
		['no data', JSON.stringify({ type: 'billing.updated' })],
		['array data', JSON.stringify({ type: 'billing.updated', data: [] })],
		['no customer id', JSON.stringify({ type: 'billing.updated', data: {} })],
		['a numeric id', JSON.stringify({ type: 'billing.updated', data: { customer_id: 12 } })],
		['a blank id', billingUpdated('  ')],
		[
			'a customer that is not an object',
			JSON.stringify({ type: 'customer.products.updated', data: { customer: 'x' } })
		],
		['conflicting ids', billingUpdated(CUSTOMER, { customer: { id: 'user_other' } })]
	])('answers 400 for %s', async (_, body) => {
		const logs = captureLogs();
		const { deliver, rows } = setup();
		const fetchMock = stubAutumn(json(payingActiveCouponCard.data));

		const response = await deliver(delivery(body));

		expect(response.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(rows()).toEqual([]);
		expect(logs.lines).toEqual([expect.stringContaining("'webhook_payload_malformed'")]);
	});

	it.each([
		['a customer Autumn does not know', json({ message: 'not found' }, 404)],
		['a customer that never paid', json(zeroTotalEndedA.data)]
	])('acknowledges %s and admits nothing', async (_, autumn) => {
		const logs = captureLogs();
		const { deliver, rows } = setup();
		stubAutumn(autumn);

		const response = await deliver(delivery(billingUpdated(CUSTOMER)));

		expect(response.status).toBe(200);
		expect(rows()).toEqual([]);
		expect(logs.lines).toEqual([]);
	});

	it.each([
		['a rate-limited read', json({}, 429), 'autumn_rate_limited'],
		['an unavailable Autumn', json({}, 503), 'autumn_unavailable'],
		['a rejected key', json({}, 401), 'autumn_auth'],
		['an unexpected status', json({}, 418), 'autumn_unexpected_status']
	])('answers 503 for %s and logs its code', async (_, autumn, code) => {
		const logs = captureLogs();
		const { deliver, rows } = setup();
		stubAutumn(autumn);

		const response = await deliver(delivery(billingUpdated(CUSTOMER)));

		expect(response.status).toBe(503);
		expect(rows()).toEqual([]);
		expect(logs.lines).toEqual([expect.stringContaining(`'${code}'`)]);
	});

	it('answers 503 when billing is not configured', async () => {
		const logs = captureLogs();
		vi.stubEnv('AUTUMN_SECRET_KEY', '');
		const { deliver } = setup();
		const fetchMock = stubAutumn(json(payingActiveCouponCard.data));

		expect((await deliver(delivery(billingUpdated(CUSTOMER)))).status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(logs.text()).toContain('billing_unconfigured');
	});

	it('acknowledges a read the normalizer cannot trust and logs its code', async () => {
		const logs = captureLogs();
		const { deliver, rows } = setup();
		const future = structuredClone(payingActiveCouponCard.data);
		future.invoices[0]!.created_at = NOW + 60 * 60_000;
		stubAutumn(json(future));

		const response = await deliver(delivery(billingUpdated(CUSTOMER)));

		expect(response.status).toBe(200);
		expect(rows()).toEqual([]);
		expect(logs.lines).toEqual([
			expect.stringContaining("'billing_malformed_invoice_time_invalid'")
		]);
	});

	it('answers 503 when admission throws, without its error text', async () => {
		const logs = captureLogs();
		const { deliver } = setup({
			[ADMIT]: {
				_handler: async () => {
					throw new Error(`admission broke: ${SENTINEL}`);
				}
			}
		});
		stubAutumn(json(payingActiveCouponCard.data));

		const response = await deliver(delivery(billingUpdated(CUSTOMER)));

		expect(response.status).toBe(503);
		expect(logs.lines).toEqual([expect.stringContaining("'admission_failed'")]);
		expect(logs.text()).not.toContain(SENTINEL);
	});
});

describe('idempotent admission', () => {
	it('admits concurrent identical deliveries once', async () => {
		const { store, deliver, rows } = setup();
		stubAutumn(json(payingActiveCouponCard.data));
		const body = billingUpdated(CUSTOMER);
		const id = 'msg_duplicate';

		const responses = await Promise.all([
			deliver(delivery(body, { id })),
			deliver(delivery(body, { id }))
		]);

		expect(responses.map((response) => response.status)).toEqual([200, 200]);
		expect(rows()).toHaveLength(1);
		expect(store.scheduled()).toHaveLength(1);
	});

	it('joins the row when Svix redelivers after a lost acknowledgement', async () => {
		const { store, deliver, rows } = setup();
		// The redelivery reads different billing: an earlier invoice and a scheduled cancellation.
		stubAutumn(json(payingActiveCouponCard.data), json(payingScheduledCancelLink.data));
		const body = billingUpdated(CUSTOMER);

		await deliver(delivery(body, { id: 'msg_lost_ack' }));
		const committed = rows();
		vi.setSystemTime(NOW + 5 * 60_000);
		const redelivered = await deliver(delivery(body, { id: 'msg_lost_ack' }));

		expect(redelivered.status).toBe(200);
		expect(rows()).toEqual(committed);
		expect(store.scheduled()).toHaveLength(1);
	});

	it('admits nothing once the secret is unset, even for a delivery verified before', async () => {
		const { store, deliver, rows } = setup();
		// The operator pauses observation while this delivery's billing read is in flight.
		stubAutumn(() => {
			vi.stubEnv('AUTUMN_WEBHOOK_SECRET', undefined);
			return Response.json(payingActiveCouponCard.data);
		});

		const response = await deliver(delivery(billingUpdated(CUSTOMER)));

		expect(response.status).toBe(200);
		expect(rows()).toEqual([]);
		expect(store.scheduled()).toEqual([]);
	});

	it('admits nothing for a customer whose account was deleted', async () => {
		const { store, deliver, rows } = setup();
		stubAutumn(json(payingActiveCouponCard.data));
		store.deleteUser(CUSTOMER);

		const response = await deliver(delivery(billingUpdated(CUSTOMER)));

		expect(response.status).toBe(200);
		expect(rows()).toEqual([]);
		expect(store.scheduled()).toEqual([]);
	});

	it('admits nothing after a billing read that timed out', { timeout: 2000 }, async () => {
		const logs = captureLogs();
		const realTimeout = AbortSignal.timeout.bind(AbortSignal);
		vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(30));
		const { store, deliver, rows } = setup();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init?: RequestInit) =>
					new Promise<never>((_, reject) => {
						init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
					})
			)
		);

		const response = await deliver(delivery(billingUpdated(CUSTOMER)));

		expect(response.status).toBe(503);
		expect(logs.text()).toContain('autumn_timeout');
		expect(rows()).toEqual([]);
		expect(store.childCalls()).toEqual([]);
	});
});

describe('private data stays out of the observer', () => {
	it('keeps payload and provider text out of responses, rows and logs', async () => {
		const logs = captureLogs();
		const { deliver, rows } = setup();
		const read = {
			...structuredClone(payingActiveCouponCard.data),
			name: SENTINEL,
			email: `${SENTINEL}@example.com`
		};
		const outcomes = [
			json(read),
			json({ message: SENTINEL }, 429),
			json({ message: SENTINEL }, 401),
			() => new Response(`{"products":[],"note":"${SENTINEL}`, { status: 200 }),
			json({ ...read, invoices: [{ ...read.invoices[0], created_at: SENTINEL }] }),
			() => {
				throw new Error(SENTINEL);
			}
		];
		const bodies: string[] = [];
		for (const outcome of outcomes) {
			stubAutumn(outcome);
			const response = await deliver(
				delivery(billingUpdated(CUSTOMER, { customer: { id: CUSTOMER, name: SENTINEL } }))
			);
			bodies.push(`${response.status} ${await response.text()}`);
		}

		expect(bodies.map((body) => body.split(' ')[0])).toEqual([
			'200',
			'503',
			'503',
			'503',
			'200',
			'503'
		]);
		expect(rows()).toHaveLength(1);
		for (const surface of [bodies.join('\n'), JSON.stringify(rows()), logs.text()]) {
			expect(surface).not.toContain(SENTINEL);
		}
	});
});
