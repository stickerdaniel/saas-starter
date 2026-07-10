import { type QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import type { BetterAuthUser } from './types';
import { parseBetterAuthUsers } from './types';

/**
 * A single condition for the Better Auth adapter's `findMany` `where` clause.
 * Shared across the admin user queries and the user-search helpers.
 */
export type AdapterWhereCondition = {
	connector?: 'AND' | 'OR';
	field: string;
	operator?:
		| 'lt'
		| 'lte'
		| 'gt'
		| 'gte'
		| 'eq'
		| 'in'
		| 'not_in'
		| 'ne'
		| 'contains'
		| 'starts_with'
		| 'ends_with';
	value: string | number | boolean | string[] | number[] | null;
};

export type UserSortBy = {
	field: 'createdAt' | 'email' | 'name' | 'role' | 'provider';
	direction: 'asc' | 'desc';
};

export type AdapterFindManyResult = {
	page: unknown[];
	isDone: boolean;
	continueCursor: string | null;
};

export const DEFAULT_USER_SORT: UserSortBy = {
	field: 'createdAt',
	direction: 'desc'
};

/**
 * Case-insensitive substring match over email and name. Blank/undefined search
 * returns the list unchanged. This is the single source of truth for admin
 * user-search semantics, shared by the users table and the audit-log search.
 */
export function applyUserSearch(users: BetterAuthUser[], search: string | undefined) {
	const trimmed = search?.trim();
	if (!trimmed) return users;
	const searchLower = trimmed.toLowerCase();
	return users.filter(
		(user) =>
			user.email?.toLowerCase().includes(searchLower) ||
			user.name?.toLowerCase().includes(searchLower)
	);
}

/**
 * Fully enumerate the users matching the given where-conditions so search and
 * offset pagination stay consistent across pages. Bounded to 500 adapter pages
 * of 200 (template-scale user table); the loop stops as soon as the adapter
 * reports it is done.
 */
export async function fetchAllUsersWithFilters(
	ctx: QueryCtx,
	args: {
		whereConditions: AdapterWhereCondition[];
		sortBy: UserSortBy;
	}
) {
	const users: BetterAuthUser[] = [];
	let cursor: string | null = null;

	for (let page = 0; page < 500; page++) {
		const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor, numItems: 200 },
			sortBy: args.sortBy,
			where: args.whereConditions.length > 0 ? args.whereConditions : undefined
		})) as AdapterFindManyResult;

		users.push(...parseBetterAuthUsers(result.page));

		if (result.isDone || !result.continueCursor) {
			break;
		}

		cursor = result.continueCursor;
	}

	return users;
}

/**
 * Collect the ids of every Better Auth user whose email or name matches the
 * search string, using the exact case-insensitive substring semantics of the
 * admin users table (see {@link applyUserSearch}). Returns an empty set for a
 * blank/undefined search.
 *
 * Enumerates the full user table via {@link fetchAllUsersWithFilters} (bounded
 * to 500 adapter pages), which is acceptable at this template's scale and
 * mirrors how the users table already resolves search — the Better Auth
 * component exposes no search index, so there is no cheaper path.
 */
export async function collectMatchingUserIds(
	ctx: QueryCtx,
	search: string | undefined
): Promise<Set<string>> {
	const trimmed = search?.trim();
	if (!trimmed) return new Set<string>();
	const allUsers = await fetchAllUsersWithFilters(ctx, {
		whereConditions: [],
		sortBy: DEFAULT_USER_SORT
	});
	const matched = applyUserSearch(allUsers, trimmed);
	return new Set(matched.map((user) => user._id));
}
