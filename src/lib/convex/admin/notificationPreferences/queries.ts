/**
 * Admin Notification Preferences Queries
 *
 * Queries for retrieving notification recipient preferences.
 * Used by the admin settings UI and notification send logic.
 */

import { v } from 'convex/values';
import { adminQuery } from '../../functions';
import { internalQuery } from '../../_generated/server';
import type { QueryCtx } from '../../_generated/server';
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

type NotificationRecipientTypeFilter = 'admin' | 'custom';

type NotificationRecipientSortBy = {
	field: 'email' | 'name' | 'type' | 'createdAt';
	direction: 'asc' | 'desc';
};

const DEFAULT_RECIPIENT_SORT: NotificationRecipientSortBy = {
	field: 'createdAt',
	direction: 'desc'
};

type AdapterFindManyResult = {
	page: unknown[];
	isDone: boolean;
	continueCursor: string | null;
};

async function getAdminUserNameMap(ctx: QueryCtx) {
	const userMap = new Map<string, string>();
	let cursor: string | null = null;

	for (let page = 0; page < 100; page++) {
		const usersResult = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor, numItems: 200 },
			where: [{ field: 'role', operator: 'eq', value: 'admin' }]
		})) as AdapterFindManyResult;
		const users = parseBetterAuthUsers(usersResult.page);

		for (const user of users) {
			userMap.set(user._id, user.name || user.email);
		}

		if (usersResult.isDone || !usersResult.continueCursor) {
			break;
		}

		cursor = usersResult.continueCursor;
	}

	return userMap;
}

function applyNotificationRecipientFilters(
	recipients: NotificationRecipient[],
	args: {
		search?: string;
		typeFilter?: NotificationRecipientTypeFilter;
	}
) {
	let filtered = recipients;

	if (args.typeFilter === 'admin') {
		filtered = filtered.filter((recipient) => recipient.isAdminUser);
	} else if (args.typeFilter === 'custom') {
		filtered = filtered.filter((recipient) => !recipient.isAdminUser);
	}

	if (args.search) {
		const search = args.search.trim().toLowerCase();
		if (search.length > 0) {
			filtered = filtered.filter((recipient) => {
				const email = recipient.email.toLowerCase();
				const name = recipient.name?.toLowerCase() ?? '';
				return email.includes(search) || name.includes(search);
			});
		}
	}

	return filtered;
}

function sortNotificationRecipients(
	recipients: NotificationRecipient[],
	sortBy: NotificationRecipientSortBy
) {
	const direction = sortBy.direction === 'asc' ? 1 : -1;
	const sorted = [...recipients];
	sorted.sort((a, b) => {
		let result = 0;

		if (sortBy.field === 'email') {
			result = a.email.localeCompare(b.email);
		} else if (sortBy.field === 'name') {
			result = (a.name ?? '').localeCompare(b.name ?? '');
		} else if (sortBy.field === 'type') {
			const aType = a.isAdminUser ? 0 : 1;
			const bType = b.isAdminUser ? 0 : 1;
			result = aType - bType;
		} else {
			result = a.createdAt - b.createdAt;
		}

		if (result === 0) {
			result = a.email.localeCompare(b.email);
		}

		return result * direction;
	});

	return sorted;
}

async function getFilteredSortedRecipients(
	ctx: QueryCtx,
	args: {
		search?: string;
		typeFilter?: NotificationRecipientTypeFilter;
		sortBy?: NotificationRecipientSortBy;
	}
) {
	const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();
	const activePrefs = allPrefs.filter(
		(preference) => preference.isAdminUser || preference.userId === undefined
	);
	const userMap = await getAdminUserNameMap(ctx);
	const recipients: NotificationRecipient[] = activePrefs.map((preference) => ({
		email: preference.email,
		name: preference.userId ? userMap.get(preference.userId) : undefined,
		userId: preference.userId,
		isAdminUser: preference.isAdminUser,
		notifyNewSupportTickets: preference.notifyNewSupportTickets,
		notifyUserReplies: preference.notifyUserReplies,
		notifyNewSignups: preference.notifyNewSignups,
		createdAt: preference.createdAt,
		updatedAt: preference.updatedAt
	}));

	const filtered = applyNotificationRecipientFilters(recipients, args);
	return sortNotificationRecipients(filtered, args.sortBy ?? DEFAULT_RECIPIENT_SORT);
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
	args: {
		cursor: v.optional(v.string()),
		numItems: v.number(),
		search: v.optional(v.string()),
		typeFilter: v.optional(v.union(v.literal('admin'), v.literal('custom'))),
		sortBy: v.optional(
			v.object({
				field: v.union(
					v.literal('email'),
					v.literal('name'),
					v.literal('type'),
					v.literal('createdAt')
				),
				direction: v.union(v.literal('asc'), v.literal('desc'))
			})
		)
	},
	returns: v.object({
		items: v.array(
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
		continueCursor: v.union(v.string(), v.null()),
		isDone: v.boolean()
	}),
	handler: async (
		ctx,
		args
	): Promise<{
		items: NotificationRecipient[];
		continueCursor: string | null;
		isDone: boolean;
	}> => {
		const recipients = await getFilteredSortedRecipients(ctx, {
			search: args.search,
			typeFilter: args.typeFilter,
			sortBy: args.sortBy
		});
		const offsetRaw = args.cursor ? Number.parseInt(args.cursor, 10) : 0;
		const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
		const pageEnd = offset + args.numItems;
		const items = recipients.slice(offset, pageEnd);
		const isDone = pageEnd >= recipients.length;

		return {
			items,
			continueCursor: isDone ? null : String(pageEnd),
			isDone
		};
	}
});

export const getNotificationRecipientCount = adminQuery({
	args: {
		search: v.optional(v.string()),
		typeFilter: v.optional(v.union(v.literal('admin'), v.literal('custom')))
	},
	returns: v.number(),
	handler: async (ctx, args): Promise<number> => {
		const recipients = await getFilteredSortedRecipients(ctx, {
			search: args.search,
			typeFilter: args.typeFilter
		});
		return recipients.length;
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
