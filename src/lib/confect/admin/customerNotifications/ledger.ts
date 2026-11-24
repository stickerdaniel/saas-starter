import type { JourneyRequest } from '../journey/source';
import type { Payment } from './billing';
import { CANCELLATION, NEW_CUSTOMER } from './policy';

type Episode = { episodeKey: string; request: JourneyRequest; sendAt: number };

/** A customer has one new-customer episode, so its key is the user. */
export const newCustomerEpisodeKey = (userId: string) => userId;

/**
 * The frozen facts of a new-customer episode. The window runs from signup to
 * `postPaymentMs` after the payment, and the send waits for the window to
 * close, but never schedules into the past.
 */
export function newCustomerEpisode(
	args: { userId: string; signupAt: number; firstPayment: Payment; now: number },
	policy: { postPaymentMs: number } = NEW_CUSTOMER
): Episode {
	const { userId, signupAt, firstPayment, now } = args;
	const paymentAt = firstPayment.invoiceAt;
	const end = paymentAt + policy.postPaymentMs;
	return {
		episodeKey: newCustomerEpisodeKey(userId),
		request: {
			episode: 'new_customer',
			userId,
			signupAt,
			paymentAt,
			window: { start: signupAt, end }
		},
		sendAt: Math.max(now, end)
	};
}

/**
 * The frozen facts of a cancellation episode. `anchor` is the payment the
 * email measures from. The window covers the `lookbackMs` before the
 * cancellation, starting no earlier than signup, and the email goes out now.
 */
export function cancellationEpisode(
	args: { userId: string; signupAt: number; anchor: Payment; canceledAt: number; now: number },
	policy: { lookbackMs: number } = CANCELLATION
): Episode {
	const { userId, signupAt, anchor, canceledAt, now } = args;
	return {
		episodeKey: `${userId}:${canceledAt}`,
		request: {
			episode: 'cancellation',
			userId,
			signupAt,
			paymentAt: anchor.invoiceAt,
			window: { start: Math.max(signupAt, canceledAt - policy.lookbackMs), end: canceledAt }
		},
		sendAt: now
	};
}
