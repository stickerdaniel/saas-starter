/**
 * Admin Notification Preferences Mutations
 *
 * Mutations for managing notification recipient preferences.
 * Includes both admin-facing mutations and internal mutations for auth triggers.
 */

import { v, ConvexError } from 'convex/values';
import { adminMutation } from '../../functions';
import { internalMutation } from '../../_generated/server';
import { components, internal } from '../../_generated/api';

/**
 * Update a notification preference toggle
 *
 * @security Requires admin role
 */
export const updatePreference = adminMutation({
	args: {
		email: v.string(),
		field: v.union(
			v.literal('notifyNewSupportTickets'),
			v.literal('notifyUserReplies'),
			v.literal('notifyNewSignups')
		),
		value: v.boolean()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// Find the preference by email
		const pref = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', args.email))
			.first();

		if (!pref) {
			throw new ConvexError('Notification preference not found');
		}

		// Verify it's an active recipient (admin or custom email)
		if (!pref.isAdminUser && pref.userId !== undefined) {
			throw new ConvexError('Cannot update dormant preference');
		}

		// Update the specific field
		await ctx.db.patch(pref._id, {
			[args.field]: args.value,
			updatedAt: Date.now()
		});

		return null;
	}
});

/**
 * Add a custom email address for notifications
 *
 * Creates a new preference with isAdminUser=false and all toggles ON.
 *
 * @security Requires admin role
 */
export const addCustomEmail = adminMutation({
	args: {
		email: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const email = args.email.toLowerCase().trim();

		// Validate email format (basic check)
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			throw new ConvexError('Invalid email address');
		}

		// Check for duplicates
		const existing = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();

		if (existing) {
			throw new ConvexError('This email already exists');
		}

		// Create new preference with all notifications enabled
		const now = Date.now();
		await ctx.db.insert('adminNotificationPreferences', {
			email,
			userId: undefined,
			isAdminUser: false,
			notifyNewSupportTickets: true,
			notifyUserReplies: true,
			notifyNewSignups: true,
			createdAt: now,
			updatedAt: now
		});

		return null;
	}
});

/**
 * Remove a custom email address
 *
 * Only allows removing custom emails (where userId is undefined).
 * Admin users cannot be removed, only their toggles disabled.
 *
 * @security Requires admin role
 */
export const removeCustomEmail = adminMutation({
	args: {
		email: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const email = args.email.toLowerCase().trim();

		const pref = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();

		if (!pref) {
			throw new ConvexError('Email not found');
		}

		// Only allow removing custom emails (no userId)
		if (pref.userId !== undefined) {
			throw new ConvexError('Cannot remove admin user. Disable their notifications instead.');
		}

		await ctx.db.delete(pref._id);
		return null;
	}
});

/**
 * Upsert admin notification preferences
 *
 * Called by auth triggers and admin role management utilities when:
 * - User is promoted to admin (setUserRole, seedFirstAdmin)
 * - Admin's email changes
 * - User signs up as admin (rare)
 *
 * If preference exists: updates isAdminUser=true and email
 * If not exists: creates with all toggles ON
 *
 * @internal Called by auth triggers and admin role management
 */
export const upsertAdminPreferences = internalMutation({
	args: {
		userId: v.string(),
		email: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const now = Date.now();

		// Check if preference already exists for this user
		const existing = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.first();

		if (existing) {
			// Reactivate and update email if changed
			await ctx.db.patch(existing._id, {
				email: args.email.toLowerCase().trim(),
				isAdminUser: true,
				updatedAt: now
			});
		} else {
			// Check if there's a custom email entry with same email
			const existingByEmail = await ctx.db
				.query('adminNotificationPreferences')
				.withIndex('by_email', (q) => q.eq('email', args.email.toLowerCase().trim()))
				.first();

			if (existingByEmail && existingByEmail.userId === undefined) {
				// Convert custom email to admin user preference
				await ctx.db.patch(existingByEmail._id, {
					userId: args.userId,
					isAdminUser: true,
					updatedAt: now
				});
			} else if (!existingByEmail) {
				// Create new preference with all notifications enabled
				await ctx.db.insert('adminNotificationPreferences', {
					email: args.email.toLowerCase().trim(),
					userId: args.userId,
					isAdminUser: true,
					notifyNewSupportTickets: true,
					notifyUserReplies: true,
					notifyNewSignups: true,
					createdAt: now,
					updatedAt: now
				});
			} else {
				// existingByEmail exists with a different userId - data integrity issue
				// Log warning but don't throw to avoid blocking auth flow
				console.warn(
					`[upsertAdminPreferences] Email collision detected: ` +
						`email=${args.email} already belongs to userId=${existingByEmail.userId} ` +
						`but attempting to assign to userId=${args.userId}. Skipping update.`
				);
			}
		}

		return null;
	}
});

/**
 * Deactivate admin notification preferences
 *
 * Called by auth trigger when admin is demoted.
 * Sets isAdminUser=false but keeps the record for potential re-promotion.
 *
 * @internal Called by auth triggers only
 */
export const deactivateAdminPreferences = internalMutation({
	args: {
		userId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				isAdminUser: false,
				updatedAt: Date.now()
			});
		}

		return null;
	}
});

/**
 * Sync all existing admin users to notification preferences
 *
 * One-time migration for existing admins created before the auth trigger.
 * Safe to run multiple times - upsertAdminPreferences handles duplicates.
 *
 * @internal Run via: bunx convex run admin/notificationPreferences/mutations:syncAllAdminPreferences
 */
export const syncAllAdminPreferences = internalMutation({
	args: {},
	returns: v.object({ synced: v.number(), skipped: v.number() }),
	handler: async (ctx) => {
		const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor: null, numItems: 1000 }
		});

		const users = result.page as Array<{ _id: string; email: string; role?: string | null }>;
		const admins = users.filter((u) => u.role === 'admin');

		let synced = 0;
		let skipped = 0;

		for (const admin of admins) {
			const existing = await ctx.db
				.query('adminNotificationPreferences')
				.withIndex('by_user', (q) => q.eq('userId', admin._id))
				.first();

			if (existing) {
				skipped++;
				continue;
			}

			await ctx.runMutation(
				internal.admin.notificationPreferences.mutations.upsertAdminPreferences,
				{
					userId: admin._id,
					email: admin.email
				}
			);
			synced++;
		}

		console.log(`Synced ${synced} admins, skipped ${skipped} (already existed)`);
		return { synced, skipped };
	}
});
