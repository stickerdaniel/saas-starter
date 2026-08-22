/**
 * Admin Notification Preferences Mutations
 *
 * Mutations for managing notification recipient preferences.
 * Includes both admin-facing mutations and internal mutations for auth triggers.
 */

import { v } from 'convex/values';
import * as val from 'valibot';
import { adminMutation } from '../../functions';
import { internalMutation } from '../../_generated/server';
import { components } from '../../_generated/api';
import { syncAdminPreferences } from './helpers';
import {
	NOTIFICATION_EMAIL_ALREADY_EXISTS,
	NOTIFICATION_PREFERENCE_ERROR_CODES,
	createNotificationPreferenceError
} from './errors';

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
			throw createNotificationPreferenceError(NOTIFICATION_PREFERENCE_ERROR_CODES.notFound);
		}

		// Verify it's an active recipient (admin or custom email)
		if (!pref.isAdminUser && pref.userId !== undefined) {
			throw createNotificationPreferenceError(NOTIFICATION_PREFERENCE_ERROR_CODES.dormant);
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

		// Validate email format
		if (!val.safeParse(val.pipe(val.string(), val.email()), email).success) {
			throw createNotificationPreferenceError(NOTIFICATION_PREFERENCE_ERROR_CODES.invalidEmail);
		}

		// Check for duplicates
		const existing = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();

		if (existing) {
			throw createNotificationPreferenceError(NOTIFICATION_EMAIL_ALREADY_EXISTS);
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
			throw createNotificationPreferenceError(NOTIFICATION_PREFERENCE_ERROR_CODES.emailNotFound);
		}

		// Only allow removing custom emails (no userId)
		if (pref.userId !== undefined) {
			throw createNotificationPreferenceError(
				NOTIFICATION_PREFERENCE_ERROR_CODES.adminRecipientRequired
			);
		}

		await ctx.db.delete(pref._id);
		return null;
	}
});

/**
 * Sync all existing admin users to notification preferences
 *
 * One-time migration for existing admins created before the auth trigger.
 * Safe to run multiple times - syncAdminPreferences handles duplicates.
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

			await syncAdminPreferences(ctx, { userId: admin._id, email: admin.email });
			synced++;
		}

		console.log(`Synced ${synced} admins, skipped ${skipped} (already existed)`);
		return { synced, skipped };
	}
});
