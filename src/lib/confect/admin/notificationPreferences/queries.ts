import * as Effect from 'effect/Effect';
import { components } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { QueryCtx as ConvexQueryCtx } from '../../../convex/_generated/server';
import { QueryCtx } from '../../_generated/services';
import { isTestEmail } from '../../emails/helpers';
import { MAX_RECIPIENTS, PREFERENCE_SCAN } from '../customerNotifications/policy';
import { resolveOffsetLastPage, sliceOffsetPage } from '../pagination';
import { parseBetterAuthUsers } from '../types';
import { isPreviewAdminEmail } from './helpers';
import type {
	ListRecipientsArgsSchema,
	NotificationRecipientSchema,
	NotificationToggleFieldSchema,
	NotificationTypeSchema,
	RecipientCountArgsSchema,
	RecipientsLastPageArgsSchema
} from './schemas';

export type NotificationType = typeof NotificationTypeSchema.Type;

export type NotificationToggleField = typeof NotificationToggleFieldSchema.Type;

type NotificationPreference = Doc<'adminNotificationPreferences'>;

const NOTIFICATION_TYPE_TOGGLES = {
	newTickets: 'notifyNewSupportTickets',
	userReplies: 'notifyUserReplies',
	newSignups: 'notifyNewSignups',
	newCustomers: 'notifyNewCustomers',
	cancellations: 'notifyCancellations'
} as const satisfies Record<NotificationType, NotificationToggleField>;

function wantsNotification(
	preference: Pick<NotificationPreference, NotificationToggleField>,
	type: NotificationType
): boolean {
	return preference[NOTIFICATION_TYPE_TOGGLES[type]] ?? true;
}

function isActiveRecipient(preference: Pick<NotificationPreference, 'isAdminUser' | 'userId'>) {
	return preference.isAdminUser || preference.userId === undefined;
}

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

export type NotificationRecipient = typeof NotificationRecipientSchema.Type;

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

async function getAdminUserNameMap(ctx: ConvexQueryCtx) {
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
	ctx: ConvexQueryCtx,
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
		notifyCancellations: wantsNotification(preference, 'cancellations'),
		createdAt: preference.createdAt,
		updatedAt: preference.updatedAt
	}));

	const filtered = applyNotificationRecipientFilters(recipients, args);
	return sortNotificationRecipients(filtered, args.sortBy ?? DEFAULT_RECIPIENT_SORT);
}

const withQuery = <A>(run: (ctx: ConvexQueryCtx) => Promise<A>) =>
	QueryCtx.use((ctx) => Effect.promise(() => run(ctx)));

export const listRecipients = (args: typeof ListRecipientsArgsSchema.Type) =>
	withQuery(async (ctx) =>
		sliceOffsetPage(await getFilteredSortedRecipients(ctx, args), args.cursor, args.numItems)
	);

export const countRecipients = (args: typeof RecipientCountArgsSchema.Type) =>
	withQuery(async (ctx) => (await getFilteredSortedRecipients(ctx, args)).length);

export const findRecipientsLastPage = (args: typeof RecipientsLastPageArgsSchema.Type) =>
	withQuery(async (ctx) =>
		resolveOffsetLastPage((await getFilteredSortedRecipients(ctx, args)).length, args.numItems)
	);

export const recipientsForType = (type: NotificationType) =>
	withQuery(async (ctx) => {
		// eslint-disable-next-line @convex-dev/no-collect-in-query -- Bounded: rows exist only through admin actions (promotions, custom recipients), one per email
		const allPrefs = await ctx.db.query('adminNotificationPreferences').collect();
		return allPrefs.filter((p) => receivesNotification(p, type)).map((p) => p.email);
	});

export const journeyRecipients = (type: NotificationType) =>
	withQuery(async (ctx) => {
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
	});
