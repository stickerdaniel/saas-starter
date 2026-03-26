import { type QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { v } from 'convex/values';
import type { AdminUserData, BetterAuthUser, BetterAuthSession } from './types';
import { parseBetterAuthUsers, parseBetterAuthSessions } from './types';
import { adminQuery } from '../functions';
import { getCounters } from './counters';

type ProviderFilter = 'credential' | 'google' | 'github' | 'passkey';

type AdapterWhereCondition = {
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

type UserSortBy = {
	field: 'createdAt' | 'email' | 'name' | 'role' | 'provider';
	direction: 'asc' | 'desc';
};

type AdapterFindManyResult = {
	page: unknown[];
	isDone: boolean;
	continueCursor: string | null;
};

const DEFAULT_USER_SORT: UserSortBy = {
	field: 'createdAt',
	direction: 'desc'
};

function addAndCondition(
	where: AdapterWhereCondition[],
	condition: Omit<AdapterWhereCondition, 'connector'>
) {
	where.push({
		...condition,
		connector: where.length > 0 ? 'AND' : undefined
	});
}

type UserRoleFilter = 'admin' | 'user';

function buildUserWhereConditions(args: {
	roleFilter?: UserRoleFilter;
	statusFilter?: 'verified' | 'unverified' | 'banned';
}) {
	const whereConditions: AdapterWhereCondition[] = [];

	// Role filter
	if (args.roleFilter) {
		addAndCondition(whereConditions, {
			field: 'role',
			operator: 'eq',
			value: args.roleFilter
		});
	}

	// Status filter
	if (args.statusFilter === 'banned') {
		addAndCondition(whereConditions, {
			field: 'banned',
			operator: 'eq',
			value: true
		});
	} else if (args.statusFilter === 'verified') {
		// Keep status semantics aligned with UI:
		// "verified" means email verified and not banned.
		addAndCondition(whereConditions, {
			field: 'banned',
			operator: 'eq',
			value: false
		});
		addAndCondition(whereConditions, {
			field: 'emailVerified',
			operator: 'eq',
			value: true
		});
	} else if (args.statusFilter === 'unverified') {
		// Keep status semantics aligned with UI:
		// "unverified" means email unverified and not banned.
		addAndCondition(whereConditions, {
			field: 'banned',
			operator: 'eq',
			value: false
		});
		addAndCondition(whereConditions, {
			field: 'emailVerified',
			operator: 'eq',
			value: false
		});
	}

	return whereConditions;
}

function applyUserSearch(users: BetterAuthUser[], search: string | undefined) {
	const trimmed = search?.trim();
	if (!trimmed) return users;
	const searchLower = trimmed.toLowerCase();
	return users.filter(
		(user) =>
			user.email?.toLowerCase().includes(searchLower) ||
			user.name?.toLowerCase().includes(searchLower)
	);
}

async function fetchAllUsersWithFilters(
	ctx: QueryCtx,
	args: {
		whereConditions: AdapterWhereCondition[];
		sortBy: UserSortBy;
	}
) {
	const users: BetterAuthUser[] = [];
	let cursor: string | null = null;

	// Fully enumerate matching users so search+pagination stay consistent.
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

async function fetchProvidersForUsers(
	ctx: QueryCtx,
	userIds: string[]
): Promise<Map<string, string[]>> {
	if (userIds.length === 0) return new Map();
	const map = new Map<string, string[]>();

	// Chunk userIds to keep per-request size bounded
	const CHUNK_SIZE = 200;
	for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
		const chunk = userIds.slice(i, i + CHUNK_SIZE);
		let cursor: string | null = null;
		// Paginate through all accounts for this chunk
		for (let page = 0; page < 500; page++) {
			const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'account',
				paginationOpts: { cursor, numItems: 200 },
				where: [{ field: 'userId', operator: 'in' as const, value: chunk }]
			})) as AdapterFindManyResult;
			for (const account of result.page) {
				const a = account as { userId?: string; providerId?: string };
				if (a.userId && a.providerId) {
					const existing = map.get(a.userId) ?? [];
					existing.push(a.providerId);
					map.set(a.userId, existing);
				}
			}
			if (result.isDone || !result.continueCursor) break;
			cursor = result.continueCursor;
		}
	}

	// Sort providers for stable UI ordering
	for (const [userId, providers] of map) {
		providers.sort();
		map.set(userId, providers);
	}

	return map;
}

async function fetchUserIdsForProvider(
	ctx: QueryCtx,
	provider: ProviderFilter
): Promise<Set<string>> {
	const accounts: Array<{ userId?: string }> = [];
	let cursor: string | null = null;
	// Bounded: paginate through all accounts with this provider
	for (let page = 0; page < 500; page++) {
		const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'account',
			paginationOpts: { cursor, numItems: 200 },
			where: [{ field: 'providerId', operator: 'eq' as const, value: provider }]
		})) as AdapterFindManyResult;
		accounts.push(...(result.page as Array<{ userId?: string }>));
		if (result.isDone || !result.continueCursor) break;
		cursor = result.continueCursor;
	}
	return new Set(accounts.map((a) => a.userId).filter(Boolean) as string[]);
}

function mapAdminUser(user: BetterAuthUser, providers: string[] = []): AdminUserData {
	return {
		id: user._id,
		name: user.name,
		email: user.email,
		emailVerified: user.emailVerified,
		image: user.image,
		role: user.role ?? 'user',
		banned: user.banned ?? false,
		banReason: user.banReason,
		banExpires: user.banExpires,
		providers,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt
	};
}

/**
 * Helper to fetch all users from the BetterAuth component
 */
async function fetchAllUsers(ctx: QueryCtx): Promise<BetterAuthUser[]> {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'user',
		paginationOpts: { cursor: null, numItems: 1000 }
	});
	return parseBetterAuthUsers(result.page);
}

/**
 * Helper to fetch all sessions from the BetterAuth component
 */
async function fetchAllSessions(ctx: QueryCtx): Promise<BetterAuthSession[]> {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'session',
		paginationOpts: { cursor: null, numItems: 1000 }
	});
	return parseBetterAuthSessions(result.page);
}

/**
 * List users with pagination for admin user management
 *
 * Uses adapter cursor pagination by default. Falls back to offset-based
 * pagination when `search` is present (fetches all matching users, then slices)
 * to support OR search across email and name fields.
 *
 * @param args.cursor - Pagination cursor (adapter cursor or offset depending on search mode)
 * @param args.numItems - Number of items to fetch per page
 * @param args.search - Optional search term to filter by email or name (triggers offset mode)
 * @param args.roleFilter - Optional role filter ('admin', 'user', or 'all')
 * @param args.statusFilter - Optional status filter ('verified', 'unverified', 'banned')
 * @param args.sortBy - Optional sort configuration with field and direction
 * @returns Paginated list of users with cursor info
 */
export const listUsers = adminQuery({
	args: {
		cursor: v.optional(v.string()),
		numItems: v.number(),
		search: v.optional(v.string()),
		roleFilter: v.optional(v.union(v.literal('admin'), v.literal('user'))),
		statusFilter: v.optional(
			v.union(v.literal('verified'), v.literal('unverified'), v.literal('banned'))
		),
		providerFilter: v.optional(
			v.union(
				v.literal('credential'),
				v.literal('google'),
				v.literal('github'),
				v.literal('passkey')
			)
		),
		sortBy: v.optional(
			v.object({
				field: v.union(
					v.literal('createdAt'),
					v.literal('email'),
					v.literal('name'),
					v.literal('role'),
					v.literal('provider')
				),
				direction: v.union(v.literal('asc'), v.literal('desc'))
			})
		)
	},
	handler: async (ctx, args) => {
		const whereConditions = buildUserWhereConditions({
			roleFilter: args.roleFilter,
			statusFilter: args.statusFilter
		});
		const isProviderSort = args.sortBy?.field === 'provider';
		// Use non-provider sort for the adapter (provider sort is applied locally after enrichment)
		const sortBy = isProviderSort ? DEFAULT_USER_SORT : (args.sortBy ?? DEFAULT_USER_SORT);

		// Provider filter/sort requires fetching account data first, so use offset mode.
		// Search also requires offset mode for multi-field OR filtering.
		if (args.search?.trim() || args.providerFilter || isProviderSort) {
			const allUsers = await fetchAllUsersWithFilters(ctx, { whereConditions, sortBy });
			let filteredUsers = applyUserSearch(allUsers, args.search);

			// Filter by provider: only include users who have an account with this provider
			if (args.providerFilter) {
				const providerUserIds = await fetchUserIdsForProvider(ctx, args.providerFilter);
				filteredUsers = filteredUsers.filter((u) => providerUserIds.has(u._id));
			}

			// Provider sort requires enriching all filtered users before pagination
			if (isProviderSort) {
				const allProviderMap = await fetchProvidersForUsers(
					ctx,
					filteredUsers.map((u) => u._id)
				);
				// Precompute sort keys to avoid repeated work in comparator
				const sortKeys = new Map<string, string>();
				for (const u of filteredUsers) {
					sortKeys.set(u._id, (allProviderMap.get(u._id) ?? []).join(','));
				}
				const dir = args.sortBy?.direction === 'asc' ? 1 : -1;
				filteredUsers.sort((a, b) => {
					return dir * (sortKeys.get(a._id) ?? '').localeCompare(sortKeys.get(b._id) ?? '');
				});
			}

			const offsetRaw = args.cursor ? Number.parseInt(args.cursor, 10) : 0;
			const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
			const pageEnd = offset + args.numItems;
			const usersPage = filteredUsers.slice(offset, pageEnd);
			const isDone = pageEnd >= filteredUsers.length;

			const providerMap = await fetchProvidersForUsers(
				ctx,
				usersPage.map((u) => u._id)
			);

			return {
				users: usersPage.map((u) => mapAdminUser(u, providerMap.get(u._id) ?? [])),
				continueCursor: isDone ? null : String(pageEnd),
				isDone
			};
		}

		// No search or provider filter: preserve adapter cursor pagination path.
		const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: {
				cursor: args.cursor ?? null,
				numItems: args.numItems
			},
			sortBy,
			where: whereConditions.length > 0 ? whereConditions : undefined
		})) as AdapterFindManyResult;

		const users = parseBetterAuthUsers(result.page);
		const providerMap = await fetchProvidersForUsers(
			ctx,
			users.map((u) => u._id)
		);

		return {
			users: users.map((u) => mapAdminUser(u, providerMap.get(u._id) ?? [])),
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Get total user count with filters for pagination
 *
 * Counts users matching the given filters. Used for pagination UI
 * to display total count alongside paginated results.
 *
 * @param args.search - Optional search term to filter by email or name
 * @param args.roleFilter - Optional role filter ('admin', 'user', or 'all')
 * @param args.statusFilter - Optional status filter ('verified', 'unverified', 'banned')
 * @returns Total count of matching users
 */
export const getUserCount = adminQuery({
	args: {
		search: v.optional(v.string()),
		roleFilter: v.optional(v.union(v.literal('admin'), v.literal('user'))),
		statusFilter: v.optional(
			v.union(v.literal('verified'), v.literal('unverified'), v.literal('banned'))
		),
		providerFilter: v.optional(
			v.union(
				v.literal('credential'),
				v.literal('google'),
				v.literal('github'),
				v.literal('passkey')
			)
		)
	},
	handler: async (ctx, args) => {
		const whereConditions = buildUserWhereConditions({
			roleFilter: args.roleFilter,
			statusFilter: args.statusFilter
		});
		const allUsers = await fetchAllUsersWithFilters(ctx, {
			whereConditions,
			sortBy: DEFAULT_USER_SORT
		});

		let filtered = applyUserSearch(allUsers, args.search);

		if (args.providerFilter) {
			const providerUserIds = await fetchUserIdsForProvider(ctx, args.providerFilter);
			filtered = filtered.filter((u) => providerUserIds.has(u._id));
		}

		return filtered.length;
	}
});

/**
 * Resolve last page metadata for users table in a single query call.
 *
 * This avoids client-side cursor walking for jump-to-last actions.
 * For search mode we can compute offset cursor directly from total.
 * For adapter cursor mode we still walk internally, but only server-side.
 */
export const resolveUsersLastPage = adminQuery({
	args: {
		numItems: v.number(),
		search: v.optional(v.string()),
		roleFilter: v.optional(v.union(v.literal('admin'), v.literal('user'))),
		statusFilter: v.optional(
			v.union(v.literal('verified'), v.literal('unverified'), v.literal('banned'))
		),
		providerFilter: v.optional(
			v.union(
				v.literal('credential'),
				v.literal('google'),
				v.literal('github'),
				v.literal('passkey')
			)
		),
		sortBy: v.optional(
			v.object({
				field: v.union(
					v.literal('createdAt'),
					v.literal('email'),
					v.literal('name'),
					v.literal('role'),
					v.literal('provider')
				),
				direction: v.union(v.literal('asc'), v.literal('desc'))
			})
		)
	},
	returns: v.object({
		page: v.number(),
		cursor: v.union(v.string(), v.null())
	}),
	handler: async (ctx, args): Promise<{ page: number; cursor: string | null }> => {
		const whereConditions = buildUserWhereConditions({
			roleFilter: args.roleFilter,
			statusFilter: args.statusFilter
		});
		const isProviderSort = args.sortBy?.field === 'provider';
		const sortBy = isProviderSort ? DEFAULT_USER_SORT : (args.sortBy ?? DEFAULT_USER_SORT);
		const pageSize = Number.isFinite(args.numItems) && args.numItems > 0 ? args.numItems : 10;
		const strideSize = Math.max(pageSize, 1000);

		const allUsers = await fetchAllUsersWithFilters(ctx, { whereConditions, sortBy });
		let filtered = applyUserSearch(allUsers, args.search);

		if (args.providerFilter) {
			const providerUserIds = await fetchUserIdsForProvider(ctx, args.providerFilter);
			filtered = filtered.filter((u) => providerUserIds.has(u._id));
		}

		const total = filtered.length;
		if (total <= 0) {
			return { page: 1, cursor: null };
		}

		const lastPage = Math.max(1, Math.ceil(total / pageSize));
		const targetOffset = (lastPage - 1) * pageSize;
		if (targetOffset <= 0) {
			return { page: 1, cursor: null };
		}

		if (args.search?.trim() || args.providerFilter || isProviderSort) {
			return {
				page: lastPage,
				cursor: String(targetOffset)
			};
		}

		let offset = 0;
		let cursor: string | null = null;

		while (offset + strideSize <= targetOffset) {
			const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor, numItems: strideSize },
				sortBy,
				where: whereConditions.length > 0 ? whereConditions : undefined
			})) as AdapterFindManyResult;

			if (result.isDone || !result.continueCursor) {
				return {
					page: lastPage,
					cursor
				};
			}

			cursor = result.continueCursor;
			offset += strideSize;
		}

		const remaining = targetOffset - offset;
		if (remaining > 0) {
			const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor, numItems: remaining },
				sortBy,
				where: whereConditions.length > 0 ? whereConditions : undefined
			})) as AdapterFindManyResult;
			cursor = result.continueCursor ?? cursor;
		}

		return {
			page: lastPage,
			cursor
		};
	}
});

/**
 * Get dashboard metrics for admin
 *
 * Computes aggregate statistics for the admin dashboard including
 * user counts, active users, and recent signups.
 *
 * @returns Dashboard metrics object with:
 *   - totalUsers: Total number of registered users
 *   - adminCount: Number of users with admin role
 *   - bannedCount: Number of banned users
 *   - activeIn24h: Unique users active in last 24 hours
 *   - recentSignups: Users registered in last 7 days
 */
export const getDashboardMetrics = adminQuery({
	args: {},
	handler: async (ctx) => {
		// Static counts from materialized singleton (avoids loading all users)
		const counters = await getCounters(ctx);

		// Time-windowed metrics — bounded by recency, so full-scan is acceptable
		const sessions = await fetchAllSessions(ctx);
		const now = Date.now();
		const oneDayAgo = now - 24 * 60 * 60 * 1000;
		const activeIn24h = sessions.filter((s) => s.updatedAt && s.updatedAt > oneDayAgo);
		const uniqueActiveUsers = new Set(activeIn24h.map((s) => s.userId));

		const users = await fetchAllUsers(ctx);
		const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
		const recentSignups = users.filter((u) => u.createdAt && u.createdAt > sevenDaysAgo).length;

		return {
			totalUsers: counters.totalUsers,
			adminCount: counters.adminCount,
			bannedCount: counters.bannedCount,
			activeIn24h: uniqueActiveUsers.size,
			recentSignups
		};
	}
});
