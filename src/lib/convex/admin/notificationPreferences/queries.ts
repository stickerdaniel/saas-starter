/**
 * Admin Notification Preferences Queries
 *
 * Queries for retrieving notification recipient preferences.
 * Used by the admin settings UI and notification send logic.
 */

import { v } from 'convex/values';
import { adminQuery } from '../../functions';
import { internalQuery } from '../../_generated/server';
import { components } from '../../_generated/api';
import { parseBetterAuthUsers } from '../types';

/**
 * Notification type validator for internal queries
 */
export const notificationTypeValidator = v.union(
	v.literal('newTickets'),
	v.literal('userReplies'),
	v.literal('newSignups')
);

export type NotificationType = 'newTickets' | 'userReplies' | 'newSignups';

/**
 * Notification recipient data for UI display
 */
export interface NotificationRecipient {
	email: string;
	name?: string;
	userId?: string;
	isAdminUser: boolean;
	notifyNewSupportTickets: boolean;
	notifyUserReplies: boolean;
	notifyNewSignups: boolean;
	createdAt: number;
	updatedAt: number;
}

/**
 * List all notification recipients for the admin settings UI
 *
 * Returns preferences where:
 * - isAdminUser=true (active admins)
 * - OR userId is undefined (custom email addresses)
 *
 * Dormant preferences (demoted admins with isAdminUser=false and userId set) are excluded.
 *
 * @security Requires admin role
 */
export const listNotificationRecipients = adminQuery({
	args: {},
	returns: v.array(
		v.object({
			email: v.string(),
			name: v.optional(v.string()),
			userId: v.optional(v.string()),
			isAdminUser: v.boolean(),
			notifyNewSupportTickets: v.boolean(),
			notifyUserReplies: v.boolean(),
			notifyNewSignups: v.boolean(),
			createdAt: v.number(),
			updatedAt: v.number()
		})
	),
	handler: async (ctx): Promise<NotificationRecipient[]> => {
		// Get all preferences
		const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();

		// Filter to active recipients (admins or custom emails)
		const activePrefs = allPrefs.filter((p) => p.isAdminUser || p.userId === undefined);

		// Get admin user IDs to fetch names
		const adminUserIds = activePrefs.filter((p) => p.userId).map((p) => p.userId as string);

		// Fetch admin user data for names
		const userMap = new Map<string, string>();
		if (adminUserIds.length > 0) {
			const usersResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor: null, numItems: 100 },
				where: [{ field: 'role', operator: 'eq', value: 'admin' }]
			});
			const users = parseBetterAuthUsers(usersResult.page);
			for (const user of users) {
				userMap.set(user._id, user.name || user.email);
			}
		}

		// Map to response format with names
		return activePrefs.map((p) => ({
			email: p.email,
			name: p.userId ? userMap.get(p.userId) : undefined,
			userId: p.userId,
			isAdminUser: p.isAdminUser,
			notifyNewSupportTickets: p.notifyNewSupportTickets,
			notifyUserReplies: p.notifyUserReplies,
			notifyNewSignups: p.notifyNewSignups,
			createdAt: p.createdAt,
			updatedAt: p.updatedAt
		}));
	}
});

/**
 * Get email addresses for a specific notification type
 *
 * Used by notification send logic to determine recipients.
 * Only returns emails where:
 * - The specific notification toggle is enabled
 * - AND (isAdminUser=true OR userId is undefined for custom emails)
 *
 * @internal Used by email send mutations
 */
export const getRecipientsForNotificationType = internalQuery({
	args: {
		type: notificationTypeValidator
	},
	returns: v.array(v.string()),
	handler: async (ctx, args): Promise<string[]> => {
		const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();

		// Map notification type to field name
		const toggleField =
			args.type === 'newTickets'
				? 'notifyNewSupportTickets'
				: args.type === 'userReplies'
					? 'notifyUserReplies'
					: 'notifyNewSignups';

		// Filter to active recipients with this notification enabled
		const activePrefs = allPrefs.filter(
			(p) => (p.isAdminUser || p.userId === undefined) && p[toggleField]
		);

		return activePrefs.map((p) => p.email);
	}
});

/**
 * Get recipients for support notifications with assigned admin priority
 *
 * If assigned admin has the notification enabled, returns only their email.
 * Otherwise, returns all recipients with the notification enabled.
 *
 * @internal Used by support notification logic
 */
export const getSupportNotificationRecipients = internalQuery({
	args: {
		assignedTo: v.optional(v.string()),
		notificationType: v.union(v.literal('newTickets'), v.literal('userReplies'))
	},
	returns: v.array(v.string()),
	handler: async (ctx, args): Promise<string[]> => {
		const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();

		// Map notification type to field name
		const toggleField =
			args.notificationType === 'newTickets' ? 'notifyNewSupportTickets' : 'notifyUserReplies';

		// Filter to active recipients with this notification enabled
		const activePrefs = allPrefs.filter(
			(p) => (p.isAdminUser || p.userId === undefined) && p[toggleField]
		);

		// If assigned admin has this notification enabled, prioritize them
		if (args.assignedTo) {
			const assignedPref = activePrefs.find((p) => p.userId === args.assignedTo);
			if (assignedPref) {
				return [assignedPref.email];
			}
		}

		return activePrefs.map((p) => p.email);
	}
});
