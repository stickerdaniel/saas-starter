import { Webhook } from 'svix';
import { internal } from '../../_generated/api';
import { env, httpAction } from '../../_generated/server';
import { readCustomerBilling } from './autumnRead';
import { normalizeCustomerBilling } from './billing';

/**
 * The Autumn webhook (`/autumn-webhook`, delivered by Svix). A billing event
 * only says that something changed, so every accepted delivery reads the
 * customer from Autumn and admits what the read shows, before answering.
 *
 * Svix redelivers on any non-2xx: 503 for anything a later attempt may fix,
 * and 400 for a payload this handler cannot use, which keeps it visible in
 * the Autumn dashboard. Admission is idempotent, so a lost acknowledgement or
 * a duplicate delivery joins the existing row.
 *
 * Logs carry a fixed code and at most the customer id; never the payload,
 * Autumn's response or an error, which may carry provider text.
 */

const BILLING_UPDATED = 'billing.updated';
const CUSTOMER_PRODUCTS_UPDATED = 'customer.products.updated';

type CustomerIdRead =
	{ kind: 'id'; customerId: string } | { kind: 'unsupported' } | { kind: 'malformed' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The customer id of a supported event. `billing.updated` carries it as
 * `data.customer_id` and `customer.products.updated` as `data.customer.id`;
 * both slots are read on both types, and a present id must be a non-blank
 * string. Two different ids, or none, make the payload malformed.
 */
function readCustomerId(event: unknown): CustomerIdRead {
	if (!isRecord(event)) return { kind: 'malformed' };
	if (event.type !== BILLING_UPDATED && event.type !== CUSTOMER_PRODUCTS_UPDATED) {
		return { kind: 'unsupported' };
	}
	const data = event.data;
	if (!isRecord(data)) return { kind: 'malformed' };
	const customer = data.customer ?? undefined;
	if (customer !== undefined && !isRecord(customer)) return { kind: 'malformed' };
	const ids: string[] = [];
	for (const slot of [data.customer_id, customer?.id]) {
		if (slot === undefined || slot === null) continue;
		if (typeof slot !== 'string' || slot.trim().length === 0) return { kind: 'malformed' };
		ids.push(slot);
	}
	const [customerId] = ids;
	if (customerId === undefined || ids.some((id) => id !== customerId)) {
		return { kind: 'malformed' };
	}
	return { kind: 'id', customerId };
}

const respond = (status: number) => new Response(null, { status });

export const handleAutumnWebhook = httpAction(async (ctx, request) => {
	const secret = env.AUTUMN_WEBHOOK_SECRET;
	let webhook: Webhook | null = null;
	try {
		if (secret) webhook = new Webhook(secret);
	} catch {
		// A secret that is not a Svix signing secret counts as no secret.
	}
	if (!webhook) {
		console.error({ code: 'webhook_not_configured' });
		return respond(503);
	}

	// Svix signs the exact bytes it sent, so verify the raw body before parsing it.
	const raw = await request.text();
	try {
		webhook.verify(raw, {
			'svix-id': request.headers.get('svix-id') ?? '',
			'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
			'svix-signature': request.headers.get('svix-signature') ?? ''
		});
	} catch {
		return respond(401);
	}

	let event: unknown;
	try {
		event = JSON.parse(raw);
	} catch {
		event = undefined;
	}
	const read = readCustomerId(event);
	if (read.kind === 'unsupported') return respond(200);
	if (read.kind === 'malformed') {
		console.warn({ code: 'webhook_payload_malformed' });
		return respond(400);
	}
	const { customerId: userId } = read;

	const billing = await readCustomerBilling(userId);
	if (billing.kind === 'not_found') return respond(200);
	if (billing.kind !== 'ok') {
		const log = billing.kind === 'failed' ? console.error : console.warn;
		log({ code: billing.code, userId });
		return respond(503);
	}

	const observedAt = Date.now();
	const observed = normalizeCustomerBilling(billing.data, observedAt);
	if (observed.kind === 'malformed') {
		console.warn({ code: `billing_malformed_${observed.code}`, userId });
		return respond(200);
	}
	if (!observed.firstPayment) return respond(200);

	try {
		await ctx.runMutation(internal.admin.customerNotifications.admission.admitObservation, {
			userId,
			firstPayment: observed.firstPayment,
			current: observed.current,
			observedAt
		});
	} catch {
		console.error({ code: 'admission_failed', userId });
		return respond(503);
	}
	return respond(200);
});
