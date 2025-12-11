import { query, type QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../auth';
import { v } from 'convex/values';

// Better Auth user type (managed by the component, not in our schema)
interface BetterAuthUser {
	_id: string;
	name?: string;
	email: string;
	emailVerified?: boolean;
	image?: string;
	role?: string;
	banned?: boolean;
	banReason?: string;
	banExpires?: number;
	createdAt?: number;
	updatedAt?: number;
}

// Better Auth session type
interface BetterAuthSession {
	_id: string;
	userId: string;
	expiresAt: number;
	impersonatedBy?: string;
}

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
 * Get total user count for admin dashboard metrics
 */
export const getUserCount = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const users = await fetchAllUsers(ctx);
		return users.length;
	}
});

/**
 * List users with pagination for admin user management
 */
export const listUsers = query({
	args: {
		limit: v.optional(v.number()),
		cursor: v.optional(v.string()),
		search: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const limit = args.limit ?? 50;
		const users = await fetchAllUsers(ctx);

		// Sort by creation time descending
		const sortedUsers = users.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

		// Filter by search term if provided
		let filteredUsers = sortedUsers;
		if (args.search) {
			const searchLower = args.search.toLowerCase();
			filteredUsers = sortedUsers.filter(
				(user) =>
					user.email?.toLowerCase().includes(searchLower) ||
					user.name?.toLowerCase().includes(searchLower)
			);
		}

		// Simple pagination using offset (cursor is the index)
		const startIndex = args.cursor ? parseInt(args.cursor) : 0;
		const paginatedUsers = filteredUsers.slice(startIndex, startIndex + limit);

		return {
			users: paginatedUsers.map((user) => ({
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
			nextCursor:
				startIndex + limit < filteredUsers.length ? String(startIndex + limit) : undefined,
			totalCount: filteredUsers.length
		};
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

		// Count active sessions (not expired)
		const now = Date.now();
		const activeSessions = sessions.filter((s) => s.expiresAt > now);

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
			activeSessions: activeSessions.length,
			recentSignups
		};
	}
});
