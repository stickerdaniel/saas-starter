import { getAuthUserId } from '@convex-dev/auth/server';
import { query, action, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { autumn } from './autumn';
import { internal } from './_generated/api';

export const list = query({
	args: {},
	returns: v.array(
		v.object({
			_id: v.id('messages'),
			_creationTime: v.number(),
			userId: v.id('users'),
			body: v.string(),
			author: v.string(),
			authorImage: v.optional(v.string())
		})
	),
	handler: async (ctx) => {
		const userId = await getAuthUserId(ctx);
		if (userId === null) {
			throw new Error('Not signed in');
		}
		// Grab the most recent messages.
		const messages = await ctx.db.query('messages').order('desc').take(100);
		// Reverse the list so that it's in a chronological order.
		return Promise.all(
			messages.reverse().map(async (message) => {
				const user = await ctx.db.get(message.userId);
				const { name, email, phone, image } = user!;
				return {
					...message,
					author: name ?? email ?? phone ?? 'Anonymous',
					authorImage: image
				};
			})
		);
	}
});

/**
 * Internal mutation to insert a message into the database.
 * Called by the send action after billing checks pass.
 */
export const insertMessage = internalMutation({
	args: {
		body: v.string(),
		userId: v.id('users')
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
		const userId = await getAuthUserId(ctx);
		if (userId === null) {
			throw new Error('Not signed in');
		}

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
