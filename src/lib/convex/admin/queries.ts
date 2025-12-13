import { query, type QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../auth';
import { v } from 'convex/values';
import type { BetterAuthUser, BetterAuthSession } from './types';

/**
 * Helper to verify admin access
 */
async function requireAdmin(ctx: QueryCtx) {
	const user = (await authComponent.getAuthUser(ctx)) as BetterAuthUser | null;
	if (!user || user.role !== 'admin') {
		throw new Error('Unauthorized: Admin access required');
	}
	return user;
}

/**
 * Helper to fetch all users from the BetterAuth component
 */
async function fetchAllUsers(ctx: QueryCtx): Promise<BetterAuthUser[]> {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'user',
		paginationOpts: { cursor: null, numItems: 1000 }
	});
	return result.page as BetterAuthUser[];
}

/**
 * Helper to fetch all sessions from the BetterAuth component
 */
async function fetchAllSessions(ctx: QueryCtx): Promise<BetterAuthSession[]> {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'session',
		paginationOpts: { cursor: null, numItems: 1000 }
	});
	return result.page as BetterAuthSession[];
}

/**
 * List users with real cursor pagination for admin user management
 */
export const listUsers = query({
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
				field: v.union(v.literal('createdAt'), v.literal('email'), v.literal('name')),
				direction: v.union(v.literal('asc'), v.literal('desc'))
			})
		)
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		// Build where conditions for filtering
		const whereConditions: Array<{
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
		}> = [];

		// Role filter
		if (args.roleFilter && args.roleFilter !== 'all') {
			whereConditions.push({
				field: 'role',
				operator: 'eq',
				value: args.roleFilter
			});
		}

		// Status filter
		if (args.statusFilter === 'banned') {
			whereConditions.push({
				field: 'banned',
				operator: 'eq',
				value: true,
				connector: whereConditions.length > 0 ? 'AND' : undefined
			});
		} else if (args.statusFilter === 'verified') {
			whereConditions.push({
				field: 'emailVerified',
				operator: 'eq',
				value: true,
				connector: whereConditions.length > 0 ? 'AND' : undefined
			});
		} else if (args.statusFilter === 'unverified') {
			whereConditions.push({
				field: 'emailVerified',
				operator: 'eq',
				value: false,
				connector: whereConditions.length > 0 ? 'AND' : undefined
			});
		}

		// Fetch with real cursor pagination
		const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: {
				cursor: args.cursor ?? null,
				numItems: args.numItems
			},
			sortBy: args.sortBy ?? { field: 'createdAt', direction: 'desc' },
			where: whereConditions.length > 0 ? whereConditions : undefined
		});

		let users = result.page as BetterAuthUser[];

		// Client-side search filtering (for multi-field search: email OR name)
		// Note: This is done client-side because the BetterAuth adapter doesn't easily support OR across fields
		if (args.search) {
			const searchLower = args.search.toLowerCase();
			users = users.filter(
				(user) =>
					user.email?.toLowerCase().includes(searchLower) ||
					user.name?.toLowerCase().includes(searchLower)
			);
		}

		return {
			users: users.map((user) => ({
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
			})),
			continueCursor: result.continueCursor as string | null,
			isDone: result.isDone as boolean
		};
	}
});

/**
 * Get total user count with filters for pagination
 */
export const getUserCount = query({
	args: {
		search: v.optional(v.string()),
		roleFilter: v.optional(v.string()),
		statusFilter: v.optional(
			v.union(v.literal('verified'), v.literal('unverified'), v.literal('banned'))
		)
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		// Build where conditions for filtering
		const whereConditions: Array<{
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
		}> = [];

		// Role filter
		if (args.roleFilter && args.roleFilter !== 'all') {
			whereConditions.push({
				field: 'role',
				operator: 'eq',
				value: args.roleFilter
			});
		}

		// Status filter
		if (args.statusFilter === 'banned') {
			whereConditions.push({
				field: 'banned',
				operator: 'eq',
				value: true,
				connector: whereConditions.length > 0 ? 'AND' : undefined
			});
		} else if (args.statusFilter === 'verified') {
			whereConditions.push({
				field: 'emailVerified',
				operator: 'eq',
				value: true,
				connector: whereConditions.length > 0 ? 'AND' : undefined
			});
		} else if (args.statusFilter === 'unverified') {
			whereConditions.push({
				field: 'emailVerified',
				operator: 'eq',
				value: false,
				connector: whereConditions.length > 0 ? 'AND' : undefined
			});
		}

		// Fetch all matching users (for count)
		const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor: null, numItems: 10000 },
			where: whereConditions.length > 0 ? whereConditions : undefined
		});

		let users = result.page as BetterAuthUser[];

		// Client-side search filtering
		if (args.search) {
			const searchLower = args.search.toLowerCase();
			users = users.filter(
				(user) =>
					user.email?.toLowerCase().includes(searchLower) ||
					user.name?.toLowerCase().includes(searchLower)
			);
		}

		return users.length;
	}
});

/**
 * Get admin audit logs
 */
export const getAuditLogs = query({
	args: {
		limit: v.optional(v.number()),
		adminUserId: v.optional(v.string()),
		targetUserId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

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
 */
export const getUserById = query({
	args: {
		userId: v.string()
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: args.userId }]
		})) as BetterAuthUser | null;

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
 */
export const getDashboardMetrics = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);

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
