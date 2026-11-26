import * as Effect from 'effect/Effect';
import type * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import { Webhook } from 'svix';
import { env } from '../../../convex/_generated/server';
import { readCustomerBilling } from './autumnRead';
import { normalizeCustomerBilling, type Current, type Payment } from './billing';

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

export type Observation = {
	readonly userId: string;
	readonly firstPayment: Payment | null;
	readonly current: Current | null;
	readonly observedAt: number;
};

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

const respond = (status: number) => HttpServerResponse.empty({ status });

const logged = (level: 'warn' | 'error', entry: { code: string; userId?: string }) =>
	(level === 'warn' ? Effect.logWarning : Effect.logError)(entry);

function webhookFor(secret: string | undefined): Webhook | null {
	try {
		return secret ? new Webhook(secret) : null;
	} catch {
		return null;
	}
}

function verified(webhook: Webhook, raw: string, headers: Record<string, string | undefined>) {
	try {
		webhook.verify(raw, {
			'svix-id': headers['svix-id'] ?? '',
			'svix-timestamp': headers['svix-timestamp'] ?? '',
			'svix-signature': headers['svix-signature'] ?? ''
		});
		return true;
	} catch {
		return false;
	}
}

function parsed(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export const handleAutumnWebhook = <R>(
	request: HttpServerRequest.HttpServerRequest,
	admit: (observation: Observation) => Effect.Effect<boolean, never, R>
) =>
	Effect.gen(function* () {
		const webhook = webhookFor(env.AUTUMN_WEBHOOK_SECRET);
		if (!webhook) {
			yield* logged('error', { code: 'webhook_not_configured' });
			return respond(503);
		}

		const raw = yield* Effect.orDie(request.text);
		if (!verified(webhook, raw, request.headers)) return respond(401);

		const read = readCustomerId(parsed(raw));
		if (read.kind === 'unsupported') return respond(200);
		if (read.kind === 'malformed') {
			yield* logged('warn', { code: 'webhook_payload_malformed' });
			return respond(400);
		}
		const { customerId: userId } = read;

		const billing = yield* readCustomerBilling(userId);
		if (billing.kind === 'not_found') return respond(200);
		if (billing.kind !== 'ok') {
			yield* logged(billing.kind === 'failed' ? 'error' : 'warn', { code: billing.code, userId });
			return respond(503);
		}

		const observedAt = Date.now();
		const observed = normalizeCustomerBilling(billing.data, observedAt);
		if (observed.kind === 'malformed') {
			yield* logged('warn', { code: `billing_malformed_${observed.code}`, userId });
			return respond(200);
		}
		if (!observed.firstPayment && !observed.current?.scheduledCancellation) return respond(200);

		const admitted = yield* admit({
			userId,
			firstPayment: observed.firstPayment,
			current: observed.current,
			observedAt
		});
		if (!admitted) {
			yield* logged('error', { code: 'admission_failed', userId });
			return respond(503);
		}
		return respond(200);
	});
