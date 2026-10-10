import type { BillingInterval } from './billing';

/**
 * The knobs of the admin customer emails. A fork changes behaviour here
 * rather than in the senders.
 */

/**
 * The Autumn plans whose customers these emails cover, with the interval
 * each one bills (`autumn.config.ts`). A payment or product for any other
 * plan is ignored.
 */
export const ELIGIBLE_PLANS = { pro: 'month' } as const satisfies Record<string, BillingInterval>;
export type EligiblePlans = Readonly<Record<string, BillingInterval>>;

/**
 * The new-customer email. `postPaymentMs` delays the send after the first
 * payment, and the journey window grows by the same amount, so the email can
 * also show what the customer did right after paying.
 */
export const NEW_CUSTOMER = { postPaymentMs: 0 };

/** At most this many recipients get one email. */
export const MAX_RECIPIENTS = 20;

/** Recipient discovery reads at most this many preference rows. */
export const PREFERENCE_SCAN = 500;
