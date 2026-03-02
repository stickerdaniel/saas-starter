import { v } from 'convex/values';
import { adminQuery, adminMutation } from '../functions';

/**
 * List notifications for the current admin user, paginated by creation time descending.
 */
export const listNotifications = adminQuery({
	args: {
		cursor: v.optional(v.string()),
		numItems: v.number()
	},
	handler: async (ctx, args) => {
		const userId = ctx.user._id;
		const numItems = Math.min(args.numItems, 50);

		// Use index for efficient pagination
		const result = await ctx.db
			.query('adminNotifications')
			.withIndex('by_user_created', (q) => q.eq('userId', userId))
			.order('desc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems
			});

		return {
			items: result.page,
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Count unread notifications for the current admin user. Capped at 100.
 */
export const unreadCount = adminQuery({
	args: {},
	handler: async (ctx) => {
		const userId = ctx.user._id;

		// Query where readAt is undefined using by_user_unread index
		const unread = await ctx.db
			.query('adminNotifications')
			.withIndex('by_user_unread', (q) => q.eq('userId', userId).eq('readAt', undefined))
			.take(101);

		return Math.min(unread.length, 100);
	}
});

/**
 * Mark a single notification as read.
 */
export const markAsRead = adminMutation({
	args: { id: v.id('adminNotifications') },
	handler: async (ctx, args) => {
		const notification = await ctx.db.get(args.id);
		if (!notification) throw new Error('Notification not found');
		if (notification.userId !== ctx.user._id) throw new Error('Unauthorized');
		await ctx.db.patch(args.id, { readAt: Date.now() });
	}
});

/**
 * Mark a single notification as unread.
 */
export const markAsUnread = adminMutation({
	args: { id: v.id('adminNotifications') },
	handler: async (ctx, args) => {
		const notification = await ctx.db.get(args.id);
		if (!notification) throw new Error('Notification not found');
		if (notification.userId !== ctx.user._id) throw new Error('Unauthorized');
		await ctx.db.patch(args.id, { readAt: undefined });
	}
});

/**
 * Mark all notifications as read for the current admin user.
 */
export const markAllAsRead = adminMutation({
	args: {},
	handler: async (ctx) => {
		const userId = ctx.user._id;
		const now = Date.now();

		const unread = await ctx.db
			.query('adminNotifications')
			.withIndex('by_user_unread', (q) => q.eq('userId', userId).eq('readAt', undefined))
			.collect();

		for (const notification of unread) {
			await ctx.db.patch(notification._id, { readAt: now });
		}

		return { count: unread.length };
	}
});

/**
 * Delete a single notification.
 */
export const deleteNotification = adminMutation({
	args: { id: v.id('adminNotifications') },
	handler: async (ctx, args) => {
		const notification = await ctx.db.get(args.id);
		if (!notification) throw new Error('Notification not found');
		if (notification.userId !== ctx.user._id) throw new Error('Unauthorized');
		await ctx.db.delete(args.id);
	}
});

/**
 * Delete all notifications for the current admin user.
 */
export const deleteAllNotifications = adminMutation({
	args: {},
	handler: async (ctx) => {
		const userId = ctx.user._id;

		const all = await ctx.db
			.query('adminNotifications')
			.withIndex('by_user_created', (q) => q.eq('userId', userId))
			.collect();

		for (const notification of all) {
			await ctx.db.delete(notification._id);
		}

		return { count: all.length };
	}
});
