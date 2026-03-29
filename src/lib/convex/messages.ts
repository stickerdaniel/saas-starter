import { internalAction } from './_generated/server';
import { v, ConvexError } from 'convex/values';
import { components, internal } from './_generated/api';
import { authedQuery, authedMutation } from './functions';
import { getAutumnSdk } from './autumn';

export const list = authedQuery({
	args: {},
	returns: v.array(
		v.object({
			_id: v.id('messages'),
			_creationTime: v.number(),
			userId: v.string(),
			body: v.string(),
			author: v.string(),
			authorImage: v.optional(v.string())
		})
	),
	handler: async (ctx) => {
		// Grab the most recent messages.
		const messages = await ctx.db.query('messages').order('desc').take(100);
		// Reverse the list so that it's in a chronological order.
		const chronological = messages.reverse();

		// Batch-fetch all unique message authors
		const uniqueUserIds = [...new Set(chronological.map((m) => m.userId))];
		const userMap = new Map<string, { name: string; image?: string }>();

		if (uniqueUserIds.length > 0) {
			// Bounded: community chat shows at most 100 messages, so unique authors is small
			const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor: null, numItems: uniqueUserIds.length },
				where: [{ field: '_id', operator: 'in', value: uniqueUserIds }]
			});
			for (const record of result.page) {
				const u = record as { _id: string; name?: string; email?: string; image?: string | null };
				userMap.set(u._id, {
					name: u.name ?? u.email ?? 'Anonymous',
					image: u.image ?? undefined
				});
			}
		}

		return chronological.map((message) => {
			const authorInfo = userMap.get(message.userId);
			return {
				...message,
				author: authorInfo?.name ?? 'Anonymous',
				authorImage: authorInfo?.image
			};
		});
	}
});

/**
 * Send a community chat message.
 *
 * Mutation (not action) so Convex optimistic updates work.
 * Billing is enforced client-side via Autumn customer balance;
 * usage tracking is scheduled as a fire-and-forget internalAction.
 */
export const send = authedMutation({
	args: { body: v.string() },
	handler: async (ctx, { body }) => {
		if (body.length > 2000) {
			throw new ConvexError('Message is too long (max 2000 characters)');
		}

		const messageId = await ctx.db.insert('messages', {
			body,
			userId: ctx.user._id
		});

		await ctx.scheduler.runAfter(0, internal.messages.trackMessageUsage, {
			userId: ctx.user._id
		});

		return { messageId };
	}
});

/**
 * Track community chat message usage via Autumn SDK.
 * Scheduled from the send mutation (fire-and-forget).
 */
export const trackMessageUsage = internalAction({
	args: { userId: v.string() },
	handler: async (_ctx, { userId }) => {
		const sdk = await getAutumnSdk();
		await sdk.track({
			customer_id: userId,
			feature_id: 'messages',
			value: 1
		});
	}
});
