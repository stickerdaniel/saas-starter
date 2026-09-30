import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { internalMutation } from '../../_generated/server';

export const enqueueRecipient = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		generation: v.string(),
		claimToken: v.string(),
		email: v.string(),
		isReopen: v.boolean(),
		isBareHandoff: v.boolean(),
		userName: v.string(),
		messages: v.array(v.object({ text: v.string(), timestamp: v.string() })),
		threadId: v.string()
	},
	returns: v.boolean(),
	handler: async (ctx, args): Promise<boolean> => {
		const notification = await ctx.db.get('pendingAdminNotifications', args.notificationId);
		if (
			!notification ||
			notification.scheduledFnId !== undefined ||
			notification.generation !== args.generation ||
			notification.claimToken !== args.claimToken ||
			notification.threadId !== args.threadId ||
			notification.claimLeaseExpiresAt === undefined ||
			notification.claimLeaseExpiresAt <= Date.now()
		)
			return false;
		const receipt = await ctx.db
			.query('supportNotificationReceipts')
			.withIndex('by_notificationId_and_generation_and_email', (q) =>
				q
					.eq('notificationId', args.notificationId)
					.eq('generation', args.generation)
					.eq('email', args.email)
			)
			.unique();
		if (receipt) return true;
		const { notificationId, generation, claimToken: _claimToken, ...emailArgs } = args;
		// Nested mutations and the receipt share the parent transaction, including rollback.
		const enqueued: boolean = await ctx.runMutation(
			internal.emails.send.sendNewTicketAdminNotification,
			emailArgs
		);
		if (!enqueued) return false;
		await ctx.db.insert('supportNotificationReceipts', {
			notificationId,
			generation,
			email: args.email
		});
		return true;
	}
});

export const cleanupReceipts = internalMutation({
	args: {
		notificationId: v.id('pendingAdminNotifications'),
		cursor: v.union(v.string(), v.null())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await ctx.db
			.query('supportNotificationReceipts')
			.withIndex('by_notificationId_and_generation_and_email', (q) =>
				q.eq('notificationId', args.notificationId)
			)
			.paginate({ cursor: args.cursor, numItems: 100, maximumBytesRead: 512 * 1024 });
		// A single bounded page keeps receipt deletion inside transaction budgets.
		for (const receipt of result.page)
			await ctx.db.delete('supportNotificationReceipts', receipt._id);
		if (!result.isDone)
			await ctx.scheduler.runAfter(
				250,
				internal.admin.support.notificationDelivery.cleanupReceipts,
				{ notificationId: args.notificationId, cursor: result.continueCursor }
			);
		return null;
	}
});
