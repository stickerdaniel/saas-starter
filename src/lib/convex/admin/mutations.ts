import { internalMutation, type MutationCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { v, ConvexError } from 'convex/values';
import type { BetterAuthUser } from './types';
import { roleValidator } from './types';
import { adminMutation } from '../functions';
import { authComponent, createAuth } from '../auth';
import {
	syncAdminPreferences,
	deactivateAdminPreferencesHelper
} from './notificationPreferences/helpers';

/**
 * Helper to fetch all users from the BetterAuth component
 */
async function fetchAllUsers(ctx: MutationCtx): Promise<BetterAuthUser[]> {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'user',
		paginationOpts: { cursor: null, numItems: 1000 }
	});
	return result.page as BetterAuthUser[];
}

/**
 * Helper to find a user by email from the BetterAuth component
 */
async function findUserByEmail(ctx: MutationCtx, email: string): Promise<BetterAuthUser | null> {
	const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', operator: 'eq', value: email }]
	});
	return user as BetterAuthUser | null;
}

/**
 * Helper to find a user by ID from the BetterAuth component
 */
async function findUserById(ctx: MutationCtx, userId: string): Promise<BetterAuthUser | null> {
	const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: userId }]
	});
	return user as BetterAuthUser | null;
}

/**
 * Run a Better Auth admin API call, mapping its APIError to a ConvexError
 * so the client sees the actual failure message (e.g. "You cannot ban
 * yourself") instead of a generic server error.
 */
async function runAdminAuthApi(call: () => Promise<unknown>, fallback: string): Promise<void> {
	try {
		await call();
	} catch (error) {
		throw new ConvexError(error instanceof Error && error.message ? error.message : fallback);
	}
}

/**
 * Ban a user
 *
 * Calls the Better Auth admin API in-process (which also revokes the
 * target's sessions) and writes the audit log entry in the same
 * transaction, so the action and its audit trail are atomic and the
 * audit fields are derived from server context.
 *
 * @param args.userId - The ID of the user to ban
 * @param args.reason - Ban reason shown to the user and stored in the audit log
 * @returns Object with success: true on completion
 */
export const banUser = adminMutation({
	args: {
		userId: v.string(),
		reason: v.string()
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
		await runAdminAuthApi(
			() => auth.api.banUser({ body: { userId: args.userId, banReason: args.reason }, headers }),
			'Failed to ban user'
		);

		await ctx.db.insert('adminAuditLogs', {
			adminUserId: ctx.user._id,
			action: 'ban_user',
			targetUserId: args.userId,
			metadata: { reason: args.reason },
			timestamp: Date.now()
		});

		return { success: true };
	}
});

/**
 * Unban a user
 *
 * Calls the Better Auth admin API in-process and writes the audit log
 * entry in the same transaction.
 *
 * @param args.userId - The ID of the user to unban
 * @returns Object with success: true on completion
 */
export const unbanUser = adminMutation({
	args: {
		userId: v.string()
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
		await runAdminAuthApi(
			() => auth.api.unbanUser({ body: { userId: args.userId }, headers }),
			'Failed to unban user'
		);

		await ctx.db.insert('adminAuditLogs', {
			adminUserId: ctx.user._id,
			action: 'unban_user',
			targetUserId: args.userId,
			metadata: {},
			timestamp: Date.now()
		});

		return { success: true };
	}
});

/**
 * Revoke all sessions of a user
 *
 * Calls the Better Auth admin API in-process and writes the audit log
 * entry in the same transaction.
 *
 * @param args.userId - The ID of the user whose sessions to revoke
 * @returns Object with success: true on completion
 */
export const revokeUserSessions = adminMutation({
	args: {
		userId: v.string()
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
		await runAdminAuthApi(
			() => auth.api.revokeUserSessions({ body: { userId: args.userId }, headers }),
			'Failed to revoke sessions'
		);

		await ctx.db.insert('adminAuditLogs', {
			adminUserId: ctx.user._id,
			action: 'revoke_sessions',
			targetUserId: args.userId,
			metadata: {},
			timestamp: Date.now()
		});

		return { success: true };
	}
});

/**
 * Set user role (for initial admin setup or role changes)
 *
 * Updates a user's role and logs the action to the audit trail.
 * Also syncs notification preferences when promoting/demoting admins.
 * Uses the local BetterAuth schema which includes admin plugin fields.
 *
 * @param args.userId - The ID of the user whose role to change
 * @param args.role - The new role to assign ('admin' or 'user')
 * @returns Object with success: true on completion
 * @throws {Error} When attempting to change own role
 * @throws {Error} When user is not found
 */
export const setUserRole = adminMutation({
	args: {
		userId: v.string(),
		role: roleValidator
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		// Prevent admin from changing their own role
		if (ctx.user._id === args.userId) {
			throw new ConvexError('Cannot change your own role');
		}

		const user = await findUserById(ctx, args.userId);

		if (!user) {
			throw new ConvexError('User not found');
		}

		const wasAdmin = user.role === 'admin';
		const isAdmin = args.role === 'admin';

		// Last-admin protection, as defense in depth: while the self-role guard
		// above holds, actor and target are two distinct admins in this
		// snapshot, so this cannot fire. It only bites if that guard is ever
		// removed or relaxed, keeping the deployment from going admin-less.
		// Counted via the role index instead of the dashboard adminCount
		// counter, which can drift.
		if (wasAdmin && !isAdmin) {
			const admins = await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				where: [{ field: 'role', operator: 'eq', value: 'admin' }],
				paginationOpts: { cursor: null, numItems: 2 }
			});
			if (admins.page.length < 2) {
				throw new ConvexError('Cannot demote the last admin');
			}
		}

		// Update user role using the component adapter (now includes role field in schema)
		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: args.userId }],
				update: { role: args.role }
			}
		});

		// Sync notification preferences (explicit call to ensure consistency)
		// This is redundant with Better Auth triggers but guarantees sync
		// even if triggers fail or when editing via Convex Dashboard
		if (!wasAdmin && isAdmin) {
			// Promoted to admin → activate/create preferences
			await syncAdminPreferences(ctx, { userId: args.userId, email: user.email });
		} else if (wasAdmin && !isAdmin) {
			// Demoted from admin → deactivate preferences (keep dormant)
			await deactivateAdminPreferencesHelper(ctx, args.userId);
		}

		// Log the action
		await ctx.db.insert('adminAuditLogs', {
			adminUserId: ctx.user._id,
			action: 'set_role',
			targetUserId: args.userId,
			metadata: { newRole: args.role, previousRole: user.role ?? 'user' },
			timestamp: Date.now()
		});

		return { success: true };
	}
});

/**
 * Seed first admin user (one-time setup)
 * This should be called once to set up the first admin
 */
// Invoked via CLI: bunx convex run admin/mutations:seedFirstAdmin
export const seedFirstAdmin = internalMutation({
	args: {
		email: v.string()
	},
	returns: v.object({ success: v.boolean(), message: v.optional(v.string()) }),
	handler: async (ctx, args) => {
		const user = await findUserByEmail(ctx, args.email);

		if (!user) {
			throw new ConvexError(`User with email ${args.email} not found`);
		}

		// Check if there are already admins
		const allUsers = await fetchAllUsers(ctx);
		const existingAdmins = allUsers.filter((u) => u.role === 'admin');
		if (existingAdmins.length > 0) {
			console.log('Admin already exists, skipping seed');
			return { success: false, message: 'Admin already exists' };
		}

		// Set user as admin using the component adapter (now includes role field in schema)
		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: user._id }],
				update: { role: 'admin' }
			}
		});

		// Create notification preferences for the new admin
		await syncAdminPreferences(ctx, { userId: user._id, email: user.email });

		console.log(`User ${args.email} has been set as admin`);
		return { success: true };
	}
});
