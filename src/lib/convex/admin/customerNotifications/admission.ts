import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import * as val from 'valibot';
import { components, internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import { env, internalMutation, type MutationCtx } from '../../_generated/server';
import { paymentValidator, currentValidator, type Payment } from './billing';
import { cancellationEpisode, newCustomerEpisode, newCustomerEpisodeKey } from './ledger';

/**
 * Admission turns one observed billing read into ledger rows. Every webhook
 * delivery observes again, and Svix redelivers whenever an acknowledgement is
 * lost, so admission is idempotent on each episode key: an existing row is
 * joined, never rescheduled, and its frozen facts are never rewritten.
 *
 * There is no release date or payment age bound: enabling the webhook on a
 * deployment with paying customers emails each of them once, on their next
 * billing event, and once more for a cancellation already scheduled then.
 */

const signupSchema = val.object({ createdAt: val.number() });

type NewRow = Pick<
	Doc<'customerNotifications'>,
	'userId' | 'kind' | 'episodeKey' | 'billing' | 'request' | 'observedAt' | 'sendAt'
>;
type Sender = FunctionReference<
	'mutation',
	'internal',
	{ notificationId: Id<'customerNotifications'> },
	null
>;

/** Insert the episode's row and schedule its sender, unless the episode already has a row. */
async function admitEpisode(ctx: MutationCtx, row: NewRow, sender: Sender): Promise<void> {
	const existing = await ctx.db
		.query('customerNotifications')
		.withIndex('by_kind_and_episode', (q) =>
			q.eq('kind', row.kind).eq('episodeKey', row.episodeKey)
		)
		.first();
	if (existing) return;

	const notificationId = await ctx.db.insert('customerNotifications', {
		...row,
		status: 'scheduled'
	});
	const scheduledFnId = await ctx.scheduler.runAt(row.sendAt, sender, { notificationId });
	await ctx.db.patch('customerNotifications', notificationId, { scheduledFnId });
}

/**
 * The payment a cancellation is measured from: the one the customer's
 * new-customer row froze, because Autumn returns only the newest invoices and
 * a later read may no longer include the first one; otherwise the first
 * payment this read shows. Null when there is neither.
 */
async function cancellationAnchor(
	ctx: MutationCtx,
	userId: string,
	observed: Payment | null
): Promise<Payment | null> {
	const newCustomer = await ctx.db
		.query('customerNotifications')
		.withIndex('by_kind_and_episode', (q) =>
			q.eq('kind', 'new_customer').eq('episodeKey', newCustomerEpisodeKey(userId))
		)
		.first();
	return newCustomer?.billing.firstPayment ?? observed;
}

/**
 * Admit what one billing read shows and schedule the sends. Runs in the
 * webhook's request, after the billing read. Writes nothing once
 * `AUTUMN_WEBHOOK_SECRET` is unset, which pauses observation even for a
 * delivery that verified before the pause, and nothing for a user that no
 * longer exists, so a delivery racing the account deletion leaves no row.
 *
 * - A first eligible payment is a `new_customer` row, sent once its window
 *   closes.
 * - A scheduled cancellation is a `cancellation` row, sent now. It needs a
 *   payment to measure from that is not later than the cancellation; a
 *   new-customer row this same read just admitted already provides one.
 *
 * A row is written whether or not any admin wants the email.
 */
export const admitObservation = internalMutation({
	args: {
		userId: v.string(),
		firstPayment: v.union(paymentValidator, v.null()),
		current: v.union(currentValidator, v.null()),
		observedAt: v.number()
	},
	returns: v.null(),
	handler: async (ctx, { userId, firstPayment, current, observedAt }) => {
		if (!env.AUTUMN_WEBHOOK_SECRET) return null;
		const user: unknown = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: userId }],
			select: ['createdAt']
		});
		if (user === null) return null;
		const { createdAt: signupAt } = val.parse(signupSchema, user);
		const now = Date.now();
		// What both episodes freeze: the payment they measure from and the product.
		const frozen = (payment: Payment) => ({
			userId,
			billing: { firstPayment: payment, current },
			observedAt
		});

		if (firstPayment) {
			const episode = newCustomerEpisode({ userId, signupAt, firstPayment, now });
			await admitEpisode(
				ctx,
				{ ...frozen(firstPayment), kind: 'new_customer', ...episode },
				internal.admin.customerNotifications.send.sendNewCustomer
			);
		}

		const canceledAt = current?.scheduledCancellation?.canceledAt;
		if (canceledAt === undefined) return null;
		const anchor = await cancellationAnchor(ctx, userId, firstPayment);
		if (!anchor || anchor.invoiceAt > canceledAt) return null;
		const episode = cancellationEpisode({ userId, signupAt, anchor, canceledAt, now });
		await admitEpisode(
			ctx,
			{ ...frozen(anchor), kind: 'cancellation', ...episode },
			internal.admin.customerNotifications.send.sendCancellation
		);
		return null;
	}
});
