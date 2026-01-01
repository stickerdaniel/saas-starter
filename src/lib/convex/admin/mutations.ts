import { internalMutation, type MutationCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { v } from 'convex/values';
import type { BetterAuthUser } from './types';
import { roleValidator, adminActionValidator, auditMetadataValidator } from './types';
import { adminMutation } from '../functions';

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
 * Log an admin action for audit trail
 * This is called from the client after BetterAuth admin actions
 */
export const logAdminAction = adminMutation({
	args: {
		action: adminActionValidator,
		targetUserId: v.string(),
		metadata: auditMetadataValidator
	},
	handler: async (ctx, args) => {
		await ctx.db.insert('adminAuditLogs', {
			adminUserId: ctx.user._id,
			action: args.action,
			targetUserId: args.targetUserId,
			metadata: args.metadata,
			timestamp: Date.now()
		});
	}
});

/**
 * Internal mutation for logging admin actions (for server-side use)
 */
export const logAdminActionInternal = internalMutation({
	args: {
		adminUserId: v.string(),
		action: adminActionValidator,
		targetUserId: v.string(),
		metadata: auditMetadataValidator
	},
	handler: async (ctx, args) => {
		await ctx.db.insert('adminAuditLogs', {
			adminUserId: args.adminUserId,
			action: args.action,
			targetUserId: args.targetUserId,
			metadata: args.metadata,
			timestamp: Date.now()
		});
	}
});

/**
 * Set user role (for initial admin setup or role changes)
 * Uses the local BetterAuth schema which includes admin plugin fields
 */
export const setUserRole = adminMutation({
	args: {
		userId: v.string(),
		role: roleValidator
	},
	handler: async (ctx, args) => {
		// Prevent admin from changing their own role
		if (ctx.user._id === args.userId) {
			throw new Error('Cannot change your own role');
		}

		const user = await findUserById(ctx, args.userId);

		if (!user) {
			throw new Error('User not found');
		}

		// Update user role using the component adapter (now includes role field in schema)
		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: args.userId }],
				update: { role: args.role }
			}
		});

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
export const seedFirstAdmin = internalMutation({
	args: {
		email: v.string()
	},
	handler: async (ctx, args) => {
		const user = await findUserByEmail(ctx, args.email);

		if (!user) {
			throw new Error(`User with email ${args.email} not found`);
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

		console.log(`User ${args.email} has been set as admin`);
		return { success: true };
	}
});
