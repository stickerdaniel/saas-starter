/**
 * The knobs of the admin customer emails. A fork changes behaviour here
 * rather than in the senders.
 */

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
