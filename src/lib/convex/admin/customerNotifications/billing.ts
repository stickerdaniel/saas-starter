import { v, type Infer } from 'convex/values';

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
