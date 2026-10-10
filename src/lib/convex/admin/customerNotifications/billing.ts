import { v, type Infer } from 'convex/values';
import { ELIGIBLE_PLANS, type EligiblePlans } from './policy';

/**
 * The billing facts the admin customer emails rely on, in the shape the
 * billing normalizer produces from one Autumn customer read. Admission
 * freezes them into the ledger row, and the email trusts them as frozen.
 *
 * Amounts are the invoice's `total` in major currency units after discounts
 * (10 means 10.00 in `currency`), and every time is epoch milliseconds, as
 * Autumn returns them. There is no current price: Autumn's customer product
 * carries none, so every amount an email shows comes from the invoice.
 */

/** The billing intervals of the plans these emails cover. */
export const billingIntervalValidator = v.union(v.literal('month'), v.literal('year'));
export type BillingInterval = Infer<typeof billingIntervalValidator>;

/**
 * The first eligible payment: the earliest returned paid invoice with a
 * positive total for an eligible plan. `interval` is the one that plan bills.
 */
export const paymentValidator = v.object({
	invoiceAt: v.number(),
	total: v.number(),
	currency: v.string(),
	planId: v.string(),
	interval: billingIntervalValidator
});
export type Payment = Infer<typeof paymentValidator>;

/**
 * The active eligible product. `scheduledCancellation` is set only while a
 * cancellation is scheduled and access has not ended yet.
 */
export const currentValidator = v.object({
	planId: v.string(),
	interval: billingIntervalValidator,
	scheduledCancellation: v.optional(v.object({ canceledAt: v.number(), accessUntil: v.number() }))
});
export type Current = Infer<typeof currentValidator>;

/** What a ledger row freezes: the payment that anchors the email and the product at admission. */
export const frozenBillingValidator = v.object({
	firstPayment: paymentValidator,
	current: v.union(currentValidator, v.null())
});
export type FrozenBilling = Infer<typeof frozenBillingValidator>;

/**
 * Normalizing one Autumn customer read (API 1.2, `GET /customers/<id>` with
 * `expand=invoices`) into the facts above. Pure: the caller passes the parsed
 * body and the current time, and gets the facts or a fixed malformed code it
 * can log without echoing provider data. Ported from Cadenza's normalizer and
 * parameterized by the eligible plans.
 */

export type MalformedBillingCode =
	| 'customer_invalid'
	| 'products_invalid'
	| 'invoices_invalid'
	| 'invoice_total_invalid'
	| 'invoice_time_invalid'
	| 'invoice_products_invalid'
	| 'invoice_currency_invalid'
	| 'cancellation_time_invalid'
	| 'period_end_invalid';

export type ObservedBilling =
	| { kind: 'observed'; firstPayment: Payment | null; current: Current | null }
	| { kind: 'malformed'; code: MalformedBillingCode };

type Malformed = Extract<ObservedBilling, { kind: 'malformed' }>;

/**
 * How far an occurrence may lie in the future before it counts as malformed.
 * A small allowance absorbs clock skew between Stripe, Autumn and Convex.
 */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(code: MalformedBillingCode): Malformed {
	return { kind: 'malformed', code };
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** An occurrence time: finite and not meaningfully in the future. */
function isOccurrence(value: unknown, now: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value <= now + FUTURE_TOLERANCE_MS;
}

function isEligible(plans: EligiblePlans, id: unknown): id is string {
	return typeof id === 'string' && Object.prototype.hasOwnProperty.call(plans, id);
}

/**
 * The earliest returned paid invoice with a positive total for an eligible
 * plan among its own products. Every field comes from that one invoice.
 * Autumn returns only the newest invoices, so "earliest" is earliest among
 * those returned.
 */
function firstEligiblePayment(
	invoices: readonly unknown[],
	plans: EligiblePlans,
	now: number
): Payment | null | Malformed {
	let first: Payment | null = null;
	for (const invoice of invoices) {
		if (!isRecord(invoice)) return malformed('invoices_invalid');
		if (invoice.status !== 'paid') continue;
		const total = invoice.total;
		if (typeof total !== 'number' || !Number.isFinite(total)) {
			return malformed('invoice_total_invalid');
		}
		if (total <= 0) continue;
		const createdAt = invoice.created_at;
		if (!isOccurrence(createdAt, now)) return malformed('invoice_time_invalid');
		const productIds: unknown = invoice.product_ids;
		if (!Array.isArray(productIds)) return malformed('invoice_products_invalid');
		const planId = productIds.find((id): id is string => isEligible(plans, id));
		if (planId === undefined) continue;
		if (first !== null && first.invoiceAt <= createdAt) continue;

		const currency = nonEmptyString(invoice.currency);
		if (!currency) return malformed('invoice_currency_invalid');
		first = { invoiceAt: createdAt, total, currency, planId, interval: plans[planId]! };
	}
	return first;
}

type EligibleProduct = {
	id: string;
	status: string;
	canceledAt: number | null;
	periodEnd: unknown;
};

/** The eligible products Autumn lists, with their cancellation stamp checked. */
function eligibleProducts(
	products: readonly unknown[],
	plans: EligiblePlans,
	now: number
): EligibleProduct[] | Malformed {
	const eligible: EligibleProduct[] = [];
	for (const product of products) {
		if (!isRecord(product)) return malformed('products_invalid');
		if (!isEligible(plans, product.id)) continue;
		if (typeof product.status !== 'string') return malformed('products_invalid');
		const canceledAt = product.canceled_at ?? null;
		if (canceledAt !== null && !isOccurrence(canceledAt, now)) {
			return malformed('cancellation_time_invalid');
		}
		eligible.push({
			id: product.id,
			status: product.status,
			canceledAt,
			periodEnd: product.current_period_end
		});
	}
	return eligible;
}

/**
 * The active eligible product. A cancellation is scheduled only while access
 * has not ended and nothing that still runs or is queued to run would keep
 * billing: every active or scheduled eligible product carries a cancellation
 * stamp.
 */
function currentProduct(
	products: readonly EligibleProduct[],
	plans: EligiblePlans,
	now: number
): Current | null | Malformed {
	const active = products.find((product) => product.status === 'active');
	if (!active) return null;
	const current: Current = { planId: active.id, interval: plans[active.id]! };
	const live = products.filter(
		(product) => product.status === 'active' || product.status === 'scheduled'
	);
	if (active.canceledAt === null || live.some((product) => product.canceledAt === null)) {
		return current;
	}
	const accessUntil = active.periodEnd;
	if (typeof accessUntil !== 'number' || !Number.isFinite(accessUntil)) {
		return malformed('period_end_invalid');
	}
	if (accessUntil <= now) return current;
	return { ...current, scheduledCancellation: { canceledAt: active.canceledAt, accessUntil } };
}

/**
 * Normalize one customer read. Anything the rules can trust is `observed`,
 * with `firstPayment` or `current` null when the customer has none; a shape
 * or time they cannot trust is `malformed`.
 */
export function normalizeCustomerBilling(
	data: unknown,
	now: number,
	plans: EligiblePlans = ELIGIBLE_PLANS
): ObservedBilling {
	if (!isRecord(data)) return malformed('customer_invalid');
	if (!Array.isArray(data.products)) return malformed('products_invalid');
	if (!Array.isArray(data.invoices)) return malformed('invoices_invalid');

	const firstPayment = firstEligiblePayment(data.invoices, plans, now);
	if (firstPayment !== null && 'kind' in firstPayment) return firstPayment;
	const products = eligibleProducts(data.products, plans, now);
	if (!Array.isArray(products)) return products;
	const current = currentProduct(products, plans, now);
	if (current !== null && 'kind' in current) return current;
	return { kind: 'observed', firstPayment, current };
}
