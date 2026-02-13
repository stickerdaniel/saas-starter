import { type QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { v } from 'convex/values';
import type { BetterAuthUser, BetterAuthSession } from './types';
import { parseBetterAuthUsers, parseBetterAuthSessions, parseUserRecord } from './types';
import { adminQuery } from '../functions';

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
	field: 'createdAt' | 'email' | 'name' | 'role';
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

function buildUserWhereConditions(args: {
	roleFilter?: string;
	statusFilter?: 'verified' | 'unverified' | 'banned';
}) {
	const whereConditions: AdapterWhereCondition[] = [];

	// Role filter
	if (args.roleFilter && args.roleFilter !== 'all') {
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
	if (!search) return users;
	const searchLower = search.toLowerCase();
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

function mapAdminUser(user: BetterAuthUser) {
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
 * List users with real cursor pagination for admin user management
 *
 * Fetches paginated users with filtering by role, status, and search.
 * Search is performed client-side to support OR across email/name fields.
 *
 * @param args.cursor - Pagination cursor for fetching next page
 * @param args.numItems - Number of items to fetch per page
 * @param args.search - Optional search term to filter by email or name
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
		roleFilter: v.optional(v.string()),
		statusFilter: v.optional(
			v.union(v.literal('verified'), v.literal('unverified'), v.literal('banned'))
		),
		sortBy: v.optional(
			v.object({
				field: v.union(
					v.literal('createdAt'),
					v.literal('email'),
					v.literal('name'),
					v.literal('role')
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
		const sortBy = args.sortBy ?? DEFAULT_USER_SORT;

		// BetterAuth adapter cannot do multi-field OR search in one paginated call.
		// For search, we fetch a consistent filtered set first, then apply offset cursor locally.
		if (args.search) {
			const allUsers = await fetchAllUsersWithFilters(ctx, { whereConditions, sortBy });
			const searchedUsers = applyUserSearch(allUsers, args.search);

			const offsetRaw = args.cursor ? Number.parseInt(args.cursor, 10) : 0;
			const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
			const pageEnd = offset + args.numItems;
			const usersPage = searchedUsers.slice(offset, pageEnd);
			const isDone = pageEnd >= searchedUsers.length;

			return {
				users: usersPage.map(mapAdminUser),
				continueCursor: isDone ? null : String(pageEnd),
				isDone
			};
		}

		// No search: preserve adapter cursor pagination path.
		const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: {
				cursor: args.cursor ?? null,
				numItems: args.numItems
			},
			sortBy,
			where: whereConditions.length > 0 ? whereConditions : undefined
		});

		return {
			users: parseBetterAuthUsers(result.page).map(mapAdminUser),
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
		roleFilter: v.optional(v.string()),
		statusFilter: v.optional(
			v.union(v.literal('verified'), v.literal('unverified'), v.literal('banned'))
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

		return applyUserSearch(allUsers, args.search).length;
	}
});

/**
 * Get admin audit logs
 *
 * Retrieves audit trail of admin actions with optional filtering
 * by admin user or target user.
 *
 * @param args.limit - Maximum number of logs to return (default: 100)
 * @param args.adminUserId - Optional filter by admin who performed the action
 * @param args.targetUserId - Optional filter by user who was affected
 * @returns Array of audit log entries sorted by timestamp (newest first)
 */
export const listAuditLogs = adminQuery({
	args: {
		limit: v.optional(v.number()),
		adminUserId: v.optional(v.string()),
		targetUserId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const limit = args.limit ?? 100;

		const logsQuery = ctx.db.query('adminAuditLogs').withIndex('by_timestamp').order('desc');

		const logs = await logsQuery.take(limit);

		// Filter by admin or target user if specified
		let filteredLogs = logs;
		if (args.adminUserId) {
			filteredLogs = filteredLogs.filter((log) => log.adminUserId === args.adminUserId);
		}
		if (args.targetUserId) {
			filteredLogs = filteredLogs.filter((log) => log.targetUserId === args.targetUserId);
		}

		return filteredLogs;
	}
});

/**
 * Get a single user by ID for admin view
 *
 * Fetches detailed user information including role, ban status,
 * and account metadata for admin user management.
 *
 * @param args.userId - The ID of the user to fetch
 * @returns User object with full details, or null if not found
 */
export const getUserById = adminQuery({
	args: {
		userId: v.string()
	},
	handler: async (ctx, args) => {
		const result = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: args.userId }]
		});

		const user = parseUserRecord(result);
		if (!user) {
			return null;
		}

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
			createdAt: user.createdAt,
			updatedAt: user.updatedAt
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
		const users = await fetchAllUsers(ctx);
		const sessions = await fetchAllSessions(ctx);

		// Count unique users active in the last 24 hours
		const now = Date.now();
		const oneDayAgo = now - 24 * 60 * 60 * 1000;
		const activeIn24h = sessions.filter((s) => s.updatedAt && s.updatedAt > oneDayAgo);
		const uniqueActiveUsers = new Set(activeIn24h.map((s) => s.userId));

		// Count users by role
		const adminCount = users.filter((u) => u.role === 'admin').length;
		const bannedCount = users.filter((u) => u.banned === true).length;

		// Get recent signups (last 7 days)
		const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
		const recentSignups = users.filter((u) => u.createdAt && u.createdAt > sevenDaysAgo).length;

		return {
			totalUsers: users.length,
			adminCount,
			bannedCount,
			activeIn24h: uniqueActiveUsers.size,
			recentSignups
		};
	}
});
