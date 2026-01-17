import { internalMutation, type MutationCtx } from '../_generated/server';
import { components, internal } from '../_generated/api';
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
 *
 * Records admin actions in the audit log for compliance and tracking.
 * This is called from the client after BetterAuth admin actions.
 *
 * @param args.action - The type of action performed (e.g., 'ban_user', 'set_role')
 * @param args.targetUserId - The ID of the user affected by the action
 * @param args.metadata - Additional context about the action (previous/new values)
 * @returns void
 */
export const createAuditLog = adminMutation({
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
export const createAuditLogInternal = internalMutation({
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
	handler: async (ctx, args) => {
		// Prevent admin from changing their own role
		if (ctx.user._id === args.userId) {
			throw new Error('Cannot change your own role');
		}

		const user = await findUserById(ctx, args.userId);

		if (!user) {
			throw new Error('User not found');
		}

		const wasAdmin = user.role === 'admin';
		const isAdmin = args.role === 'admin';

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
			await ctx.runMutation(
				internal.admin.notificationPreferences.mutations.upsertAdminPreferences,
				{ userId: args.userId, email: user.email }
			);
		} else if (wasAdmin && !isAdmin) {
			// Demoted from admin → deactivate preferences (keep dormant)
			await ctx.runMutation(
				internal.admin.notificationPreferences.mutations.deactivateAdminPreferences,
				{ userId: args.userId }
			);
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

		// Create notification preferences for the new admin
		await ctx.runMutation(internal.admin.notificationPreferences.mutations.upsertAdminPreferences, {
			userId: user._id,
			email: user.email
		});

		console.log(`User ${args.email} has been set as admin`);
		return { success: true };
	}
});
