import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { internal } from '../../../convex/_generated/api';
import type { MutationCtx as ConvexMutationCtx } from '../../../convex/_generated/server';
import refs from '../../_generated/refs';
import databaseSchema from '../../_generated/schema';
import { MutationCtx, Scheduler } from '../../_generated/services';
import notificationDelivery from './notificationDelivery.spec';
import type { ReceiptCleanupArgsSchema, RecipientEnqueueArgsSchema } from './schemas';

const withCtx = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const enqueueNotificationRecipient = (args: typeof RecipientEnqueueArgsSchema.Type) =>
	withCtx(async (ctx): Promise<boolean> => {
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
	});

const cleanupNotificationReceipts = ({
	notificationId,
	cursor
}: typeof ReceiptCleanupArgsSchema.Type) =>
	Effect.gen(function* () {
		const result = yield* withCtx(async (ctx) => {
			const page = await ctx.db
				.query('supportNotificationReceipts')
				.withIndex('by_notificationId_and_generation_and_email', (q) =>
					q.eq('notificationId', notificationId)
				)
				.paginate({ cursor, numItems: 100, maximumBytesRead: 512 * 1024 });
			// A single bounded page keeps receipt deletion inside transaction budgets.
			for (const receipt of page.page)
				await ctx.db.delete('supportNotificationReceipts', receipt._id);
			return page;
		});
		if (!result.isDone) {
			yield* (yield* Scheduler).runAfter(
				Duration.millis(250),
				refs.internal.admin.support.notificationDelivery.cleanupReceipts,
				{ notificationId, cursor: result.continueCursor }
			);
		}
		return null;
	});

export default GroupImpl.make(databaseSchema, notificationDelivery).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, notificationDelivery, 'cleanupReceipts', (args) =>
			Effect.gen(function* () {
				return yield* cleanupNotificationReceipts(args);
			})
		),
		FunctionImpl.make(databaseSchema, notificationDelivery, 'enqueueRecipient', (args) =>
			Effect.gen(function* () {
				return yield* enqueueNotificationRecipient(args);
			})
		)
	]),
	GroupImpl.finalize
);
