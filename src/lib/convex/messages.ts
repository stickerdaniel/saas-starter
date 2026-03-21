import { action, internalMutation } from './_generated/server';
import { v, ConvexError } from 'convex/values';
import { autumn } from './autumn';
import { components, internal } from './_generated/api';
import { authComponent } from './auth';
import { authedQuery } from './functions';

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
 * Internal mutation to insert a message into the database.
 * Called by the send action after billing checks pass.
 */
export const insertMessage = internalMutation({
	args: {
		body: v.string(),
		userId: v.string()
	},
	returns: v.id('messages'),
	handler: async (ctx, { body, userId }) => {
		return await ctx.db.insert('messages', { body, userId });
	}
});

/**
 * Send a message action.
 * Checks billing limits, inserts message, and tracks usage.
 */
export const send = action({
	args: { body: v.string() },
	returns: v.object({
		success: v.boolean(),
		error: v.optional(v.string()),
		remainingMessages: v.optional(v.number())
	}),
	handler: async (ctx, { body }) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new ConvexError('Not signed in');
		}
		const userId = user._id;

		// Check if user has available messages
		const checkResult = await autumn.check(ctx, { featureId: 'messages' });

		// Handle error or null data
		if (checkResult.error || !checkResult.data) {
			return {
				success: false,
				error: checkResult.error?.message ?? 'Failed to check message limit',
				remainingMessages: 0
			};
		}

		if (!checkResult.data.allowed) {
			return {
				success: false,
				error: 'Message limit reached. Please upgrade to Pro for unlimited messages.',
				remainingMessages: 0
			};
		}

		// Insert the message
		await ctx.runMutation(internal.messages.insertMessage, { body, userId });

		// Track message usage
		await autumn.track(ctx, { featureId: 'messages', value: 1 });

		// Return success with remaining messages
		const balance = checkResult.data.balance;
		return {
			success: true,
			remainingMessages: balance !== null && balance !== undefined ? balance - 1 : undefined
		};
	}
});
