import { internalAction, internalMutation } from './_generated/server';
import { v, ConvexError } from 'convex/values';
import { components, internal } from './_generated/api';
import { authedQuery, authedMutation } from './functions';
import { getAutumnSdk } from './autumn';
import { appRateLimiter } from './rateLimit';
import { createRateLimitError } from './support/types';

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
 * Mutation (not action) so Convex optimistic updates work. The Autumn
 * entitlement check needs an action context, so the message-quota
 * backstop runs in the scheduled follow-up: it removes the inserted
 * message when the sender is over their limit (only reachable by a
 * direct API call that bypasses the client guard). A per-user rate
 * limiter caps send frequency here in the mutation.
 */
export const send = authedMutation({
	args: { body: v.string() },
	handler: async (ctx, { body }) => {
		if (body.length > 2000) {
			throw new ConvexError('Message is too long (max 2000 characters)');
		}

		const status = await appRateLimiter.limit(ctx, 'communityMessage', { key: ctx.user._id });
		if (!status.ok) {
			throw createRateLimitError(status.retryAfter, 'Too many messages. Please wait a moment.');
		}

		const messageId = await ctx.db.insert('messages', {
			body,
			userId: ctx.user._id
		});

		await ctx.scheduler.runAfter(0, internal.messages.enforceAndTrackMessageUsage, {
			userId: ctx.user._id,
			messageId
		});

		return { messageId };
	}
});

/**
 * Delete a community chat message. Internal only, used by the quota
 * backstop to roll back an over-limit message.
 */
export const removeMessage = internalMutation({
	args: { messageId: v.id('messages') },
	returns: v.null(),
	handler: async (ctx, { messageId }) => {
		const message = await ctx.db.get(messageId);
		if (message) {
			await ctx.db.delete(messageId);
		}
		return null;
	}
});

/**
 * Enforce the community chat message quota and track usage via Autumn.
 * Scheduled from the send mutation. The entitlement check needs an
 * action (HTTP), so enforcement happens here rather than in the
 * mutation: over-limit messages are removed, allowed ones are tracked.
 */
export const enforceAndTrackMessageUsage = internalAction({
	args: { userId: v.string(), messageId: v.id('messages') },
	returns: v.null(),
	handler: async (ctx, { userId, messageId }) => {
		const sdk = await getAutumnSdk();

		let allowed = true;
		try {
			const result = await sdk.check({ customer_id: userId, feature_id: 'messages' });
			// Only a definitive not-allowed response removes the message. A
			// missing `data` (HTTP error) or a thrown network error keeps the
			// message — never delete a legitimate message on a transient fault.
			if (result.data && !result.data.allowed) {
				allowed = false;
			}
		} catch (error) {
			console.warn('[enforceAndTrackMessageUsage] Autumn check failed, keeping message:', error);
			return null;
		}

		if (!allowed) {
			await ctx.runMutation(internal.messages.removeMessage, { messageId });
			return null;
		}

		await sdk.track({ customer_id: userId, feature_id: 'messages', value: 1 });
		return null;
	}
});
