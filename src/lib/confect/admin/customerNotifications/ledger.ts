import { defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';
import {
	journeyEpisodeValidator,
	journeyRequestFields,
	type JourneyRequest
} from '../journey/source';
import { frozenBillingValidator, type Payment } from './billing';
import { CANCELLATION, NEW_CUSTOMER } from './policy';

/**
 * The admin customer email ledger: one row per episode, written by admission
 * and finished by the episode's sender.
 *
 * A `new_customer` episode is the customer's first eligible payment, keyed by
 * the user. A `cancellation` episode is one observed scheduled cancellation,
 * keyed by the user and the cancellation time, so a cancellation withdrawn and
 * later made again is a new episode. `billing` and `request` are frozen at
 * admission and never rewritten, so a redelivered billing event joins the row
 * instead of moving its window. `enqueued` means at least one recipient's component enqueue
 * committed, not that anything was delivered; delivery state lives in the
 * Resend component under `emailIds`.
 */

export const skippedReasonValidator = v.union(
	v.literal('owner_deleted'),
	v.literal('test_customer'),
	v.literal('email_unavailable'),
	v.literal('no_recipients'),
	// The bounded recipient scan found nobody but did not see every preference row.
	v.literal('audience_incomplete')
);
export type SkippedReason = Infer<typeof skippedReasonValidator>;

export const customerNotifications = defineTable({
	userId: v.string(),
	kind: journeyEpisodeValidator,
	episodeKey: v.string(),
	status: v.union(
		v.literal('scheduled'),
		v.literal('enqueued'),
		v.literal('skipped'),
		v.literal('failed')
	),
	skippedReason: v.optional(skippedReasonValidator),
	// Set when the send failed before any recipient was attempted.
	failedReason: v.optional(v.literal('audience_unavailable')),
	billing: frozenBillingValidator,
	request: v.object(journeyRequestFields),
	observedAt: v.number(),
	sendAt: v.number(),
	scheduledFnId: v.optional(v.id('_scheduled_functions')),
	emailIds: v.optional(v.array(v.string())),
	enqueuedCount: v.optional(v.number()),
	failedCount: v.optional(v.number()),
	audienceTruncated: v.optional(v.boolean()),
	completedAt: v.optional(v.number())
})
	.index('by_kind_and_episode', ['kind', 'episodeKey'])
	.index('by_user', ['userId']);

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
