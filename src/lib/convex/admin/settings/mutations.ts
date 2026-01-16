import { v } from 'convex/values';
import { z } from 'zod';
import { adminMutation } from '../../functions';
import { ADMIN_SETTING_KEYS } from './queries';

/**
 * Update an admin setting
 *
 * Creates the setting if it doesn't exist, or updates it if it does.
 *
 * @param args.key - The setting key to update
 * @param args.value - The new value (empty string to clear)
 */
export const updateSetting = adminMutation({
	args: {
		key: v.string(),
		value: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', args.key))
			.first();

		if (existing) {
			// Update existing setting
			await ctx.db.patch(existing._id, {
				value: args.value,
				updatedAt: Date.now(),
				updatedBy: ctx.user._id
			});
		} else {
			// Create new setting
			await ctx.db.insert('adminSettings', {
				key: args.key,
				value: args.value,
				updatedAt: Date.now(),
				updatedBy: ctx.user._id
			});
		}

		return null;
	}
});

/**
 * Delete an admin setting
 *
 * Removes a setting from the database entirely.
 *
 * @param args.key - The setting key to delete
 * @returns boolean - true if deleted, false if not found
 */
export const deleteSetting = adminMutation({
	args: {
		key: v.string()
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', args.key))
			.first();

		if (existing) {
			await ctx.db.delete(existing._id);
			return true;
		}

		return false;
	}
});

/**
 * Update the default support notification email
 *
 * Convenience wrapper for setting the default email.
 * Pass empty string to clear/disable the default email notification.
 * Validates email format server-side for defense-in-depth.
 *
 * @param args.email - The email address or empty string to clear
 */
export const updateDefaultSupportEmail = adminMutation({
	args: {
		email: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const key = ADMIN_SETTING_KEYS.DEFAULT_SUPPORT_EMAIL;
		const normalizedEmail = args.email.trim().toLowerCase();

		// Validate email format (allow empty string to clear)
		if (normalizedEmail !== '') {
			const emailSchema = z.string().email();
			const result = emailSchema.safeParse(normalizedEmail);
			if (!result.success) {
				throw new Error('Invalid email format');
			}
		}

		const existing = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', key))
			.first();

		if (normalizedEmail === '') {
			// Clear the setting by deleting it
			if (existing) {
				await ctx.db.delete(existing._id);
			}
		} else if (existing) {
			// Update existing
			await ctx.db.patch(existing._id, {
				value: normalizedEmail,
				updatedAt: Date.now(),
				updatedBy: ctx.user._id
			});
		} else {
			// Create new
			await ctx.db.insert('adminSettings', {
				key,
				value: normalizedEmail,
				updatedAt: Date.now(),
				updatedBy: ctx.user._id
			});
		}

		return null;
	}
});
