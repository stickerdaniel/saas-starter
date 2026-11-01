/**
 * Admin Notification Preferences Mutations
 *
 * Mutations for managing notification recipient preferences.
 * Includes both admin-facing mutations and internal mutations for auth triggers.
 */

import { v } from 'convex/values';
import * as val from 'valibot';
import { adminMutation } from '../../functions';
import { internalMutation, type MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import { syncAdminPreferences } from './helpers';
import { notificationToggleFieldValidator } from './queries';
import {
	NOTIFICATION_EMAIL_ALREADY_EXISTS,
	NOTIFICATION_PREFERENCE_ERROR_CODES,
	createNotificationPreferenceError
} from './errors';

/**
 * Bulk toggles come from the selection on one table page, so a batch never
 * holds more emails than the largest page size of the recipients table.
 */
const MAX_PREFERENCE_BATCH_SIZE = 50;

/** Find the preference an admin may toggle: an admin user or a custom email. */
async function getTogglablePreference(ctx: MutationCtx, email: string) {
	const pref = await ctx.db
		.query('adminNotificationPreferences')
		.withIndex('by_email', (q) => q.eq('email', email))
		.first();

	if (!pref) {
		throw createNotificationPreferenceError(NOTIFICATION_PREFERENCE_ERROR_CODES.notFound);
	}

	// Verify it's an active recipient (admin or custom email)
	if (!pref.isAdminUser && pref.userId !== undefined) {
		throw createNotificationPreferenceError(NOTIFICATION_PREFERENCE_ERROR_CODES.dormant);
	}

	return pref;
}

/**
 * Update a notification preference toggle
 *
 * @security Requires admin role
 */
export const updatePreference = adminMutation({
	args: {
		email: v.string(),
		field: notificationToggleFieldValidator,
		value: v.boolean()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const pref = await getTogglablePreference(ctx, args.email);

		// Update the specific field
		await ctx.db.patch('adminNotificationPreferences', pref._id, {
			[args.field]: args.value,
			updatedAt: Date.now()
		});

		return null;
	}
});

/**
 * Set one notification toggle for several recipients at once
 *
 * All or nothing: every email is resolved before the first patch, so an
 * unknown or dormant recipient fails the whole batch without a write.
 *
 * @security Requires admin role
 */
export const updatePreferences = adminMutation({
	args: {
		emails: v.array(v.string()),
		field: notificationToggleFieldValidator,
		value: v.boolean()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (
			args.emails.length === 0 ||
			args.emails.length > MAX_PREFERENCE_BATCH_SIZE ||
			new Set(args.emails).size !== args.emails.length
		) {
			throw createNotificationPreferenceError(NOTIFICATION_PREFERENCE_ERROR_CODES.invalidBatch);
		}

		// Resolve every recipient before the first patch, so a bad email writes nothing.
		const prefs = await Promise.all(args.emails.map((email) => getTogglablePreference(ctx, email)));

		const updatedAt = Date.now();
		for (const pref of prefs) {
			await ctx.db.patch('adminNotificationPreferences', pref._id, {
				[args.field]: args.value,
				updatedAt
			});
		}

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
			notifyNewCustomers: true,
			notifyCancellations: true,
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

		await ctx.db.delete('adminNotificationPreferences', pref._id);
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
