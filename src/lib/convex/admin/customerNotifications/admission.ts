import { v } from 'convex/values';
import * as val from 'valibot';
import { components, internal } from '../../_generated/api';
import { env, internalMutation } from '../../_generated/server';
import { paymentValidator, currentValidator } from './billing';
import { newCustomerEpisode } from './ledger';

/**
 * Admission turns one observed billing read into a ledger row. Every webhook
 * delivery observes again, and Svix redelivers whenever an acknowledgement is
 * lost, so admission is idempotent on the episode key: an existing row is
 * joined, never rescheduled, and its frozen facts are never rewritten.
 *
 * There is no release date or payment age bound: enabling the webhook on a
 * deployment with paying customers emails each of them once, on their next
 * billing event.
 */

const signupSchema = val.object({ createdAt: val.number() });

/**
 * Admit a first eligible payment as a `new_customer` row and schedule its
 * send. Runs in the webhook's request, after the billing read. Writes nothing
 * once `AUTUMN_WEBHOOK_SECRET` is unset, which pauses observation even for a
 * delivery that verified before the pause, and nothing for a user that no
 * longer exists, so a delivery racing the account deletion leaves no row.
 * A row is written whether or not any admin wants the email.
 */
export const admitObservation = internalMutation({
	args: {
		userId: v.string(),
		firstPayment: paymentValidator,
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

		const { episodeKey, request, sendAt } = newCustomerEpisode({
			userId,
			signupAt,
			firstPayment,
			now: Date.now()
		});
		const existing = await ctx.db
			.query('customerNotifications')
			.withIndex('by_kind_and_episode', (q) =>
				q.eq('kind', 'new_customer').eq('episodeKey', episodeKey)
			)
			.first();
		if (existing) return null;

		const notificationId = await ctx.db.insert('customerNotifications', {
			userId,
			kind: 'new_customer',
			episodeKey,
			status: 'scheduled',
			billing: { firstPayment, current },
			request,
			observedAt,
			sendAt
		});
		const scheduledFnId = await ctx.scheduler.runAt(
			sendAt,
			internal.admin.customerNotifications.send.sendNewCustomer,
			{ notificationId }
		);
		await ctx.db.patch('customerNotifications', notificationId, { scheduledFnId });
		return null;
	}
});
