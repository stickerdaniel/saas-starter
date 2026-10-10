/**
 * Admin Notification Preferences Queries
 *
 * Queries for retrieving notification recipient preferences.
 * Used by the admin settings UI and notification send logic.
 */

import { v, type Infer } from 'convex/values';
import { adminQuery } from '../../functions';
import { internalQuery } from '../../_generated/server';
import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { components } from '../../_generated/api';
import { isTestEmail } from '../../emails/helpers';
import { MAX_RECIPIENTS, PREFERENCE_SCAN } from '../customerNotifications/policy';
import { parseBetterAuthUsers } from '../types';
import { resolveOffsetLastPage, sliceOffsetPage } from '../pagination';
import { isPreviewAdminEmail } from './helpers';

/**
 * Notification type validator for internal queries
 */
export const notificationTypeValidator = v.union(
	v.literal('newTickets'),
	v.literal('userReplies'),
	v.literal('newSignups'),
	v.literal('newCustomers')
);

export type NotificationType = Infer<typeof notificationTypeValidator>;

/** The preference fields an admin toggles, one per notification type. */
export const notificationToggleFieldValidator = v.union(
	v.literal('notifyNewSupportTickets'),
	v.literal('notifyUserReplies'),
	v.literal('notifyNewSignups'),
	v.literal('notifyNewCustomers')
);

export type NotificationToggleField = Infer<typeof notificationToggleFieldValidator>;

type NotificationPreference = Doc<'adminNotificationPreferences'>;

/** The toggle that gates each notification type; exhaustive by construction. */
const NOTIFICATION_TYPE_TOGGLES = {
	newTickets: 'notifyNewSupportTickets',
	userReplies: 'notifyUserReplies',
	newSignups: 'notifyNewSignups',
	newCustomers: 'notifyNewCustomers'
} as const satisfies Record<NotificationType, NotificationToggleField>;

/**
 * Whether a preference row wants notifications of `type`. The only place a
 * toggle is read: a toggle added after rows already existed is optional, and
 * a missing value means on.
 */
function wantsNotification(
	preference: Pick<NotificationPreference, NotificationToggleField>,
	type: NotificationType
): boolean {
	return preference[NOTIFICATION_TYPE_TOGGLES[type]] ?? true;
}

/** A current admin or a custom address; a demoted admin's row stays dormant. */
function isActiveRecipient(preference: Pick<NotificationPreference, 'isAdminUser' | 'userId'>) {
	return preference.isAdminUser || preference.userId === undefined;
}

/**
 * Whether a preference row receives email of `type`: an active recipient
 * with the toggle on. The preview admin never receives email, whatever its
 * stored toggles say.
 */
export function receivesNotification(
	preference: NotificationPreference,
	type: NotificationType
): boolean {
	return (
		!isPreviewAdminEmail(preference.email) &&
		isActiveRecipient(preference) &&
		wantsNotification(preference, type)
	);
}

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
	notifyNewCustomers: boolean;
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
		let result: number;

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
	// eslint-disable-next-line @convex-dev/no-collect-in-query -- Bounded: rows exist only through admin actions (promotions, custom recipients), one per email; search, sort and count need every row
	const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();
	const activePrefs = allPrefs.filter(isActiveRecipient);
	const userMap = await getAdminUserNameMap(ctx);
	const recipients: NotificationRecipient[] = activePrefs.map((preference) => ({
		email: preference.email,
		name: preference.userId ? userMap.get(preference.userId) : undefined,
		userId: preference.userId,
		isAdminUser: preference.isAdminUser,
		notifyNewSupportTickets: wantsNotification(preference, 'newTickets'),
		notifyUserReplies: wantsNotification(preference, 'userReplies'),
		notifyNewSignups: wantsNotification(preference, 'newSignups'),
		notifyNewCustomers: wantsNotification(preference, 'newCustomers'),
		createdAt: preference.createdAt,
		updatedAt: preference.updatedAt
	}));

	const filtered = applyNotificationRecipientFilters(recipients, args);
	return sortNotificationRecipients(filtered, args.sortBy ?? DEFAULT_RECIPIENT_SORT);
}

/**
 * List notification recipients (paginated) for the admin settings UI
 *
 * Returns preferences where:
 * - isAdminUser=true (active admins)
 * - OR userId is undefined (custom email addresses)
 *
 * Dormant preferences (demoted admins with isAdminUser=false and userId set) are excluded.
 * Uses offset-based pagination over the filtered/sorted result set.
 *
 * @param args.cursor - Offset cursor (stringified integer) for the next page
 * @param args.numItems - Number of items per page
 * @param args.search - Optional search term to filter by email or name
 * @param args.typeFilter - Optional filter by recipient type ('admin' or 'custom')
 * @param args.sortBy - Optional sort configuration with field and direction
 * @returns Paginated list with `items`, `continueCursor`, and `isDone`
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
				notifyNewCustomers: v.boolean(),
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
		return sliceOffsetPage(recipients, args.cursor, args.numItems);
	}
});

/**
 * Count notification recipients matching the given filters.
 *
 * Applies the same search and type filters as `listNotificationRecipients`
 * to provide an accurate total for pagination UI.
 *
 * @param args.search - Optional search term to filter by email or name
 * @param args.typeFilter - Optional filter by recipient type ('admin' or 'custom')
 * @returns Total count of matching recipients
 * @security Requires admin role
 */
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

export const resolveNotificationRecipientsLastPage = adminQuery({
	args: {
		numItems: v.number(),
		search: v.optional(v.string()),
		typeFilter: v.optional(v.union(v.literal('admin'), v.literal('custom')))
	},
	returns: v.object({
		page: v.number(),
		cursor: v.union(v.string(), v.null())
	}),
	handler: async (ctx, args): Promise<{ page: number; cursor: string | null }> => {
		const recipients = await getFilteredSortedRecipients(ctx, {
			search: args.search,
			typeFilter: args.typeFilter
		});
		return resolveOffsetLastPage(recipients.length, args.numItems);
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
		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Bounded: rows exist only through admin actions (promotions, custom recipients), one per email
		const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();
		return allPrefs.filter((p) => receivesNotification(p, args.type)).map((p) => p.email);
	}
});

/**
 * The recipients of one customer email, from a bounded scan: at most
 * `PREFERENCE_SCAN` preference rows in creation order, and at most
 * `MAX_RECIPIENTS` of the addresses that receive `type`, test addresses left
 * out. `truncated` says that rows were left unread or matches left out, so
 * the result is not the whole audience; nobody counts what was left out.
 *
 * Callers run it under read limits, so a scan of unusually large rows fails
 * instead of taking the caller's budget.
 *
 * @internal Used by the admin customer email senders
 */
export const getJourneyRecipients = internalQuery({
	args: { type: notificationTypeValidator },
	returns: v.object({ emails: v.array(v.string()), truncated: v.boolean() }),
	handler: async (ctx, { type }) => {
		const scanned = await ctx.db.query('adminNotificationPreferences').take(PREFERENCE_SCAN + 1);
		const matched = scanned
			.slice(0, PREFERENCE_SCAN)
			.filter((preference) => receivesNotification(preference, type))
			.map((preference) => preference.email)
			.filter((email) => !isTestEmail(email));
		return {
			emails: matched.slice(0, MAX_RECIPIENTS),
			truncated: scanned.length > PREFERENCE_SCAN || matched.length > MAX_RECIPIENTS
		};
	}
});
