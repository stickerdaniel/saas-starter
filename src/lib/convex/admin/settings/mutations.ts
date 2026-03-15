import { v } from 'convex/values';
import { adminMutation } from '../../functions';

/**
 * Key prefixes reserved for dedicated mutation endpoints with custom access control.
 * The generic updateSetting/deleteSetting endpoints reject these to prevent bypass.
 */
const RESERVED_KEY_PREFIXES = ['founderWelcome.'] as const;

function isReservedKey(key: string): boolean {
	return RESERVED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Update an admin setting
 *
 * Creates the setting if it doesn't exist, or updates it if it does.
 * Reserved key prefixes are rejected — use their dedicated endpoints instead.
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
		if (isReservedKey(args.key)) {
			throw new Error(`Key "${args.key}" is managed by a dedicated endpoint`);
		}

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
 * Reserved key prefixes are rejected — use their dedicated endpoints instead.
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
		if (isReservedKey(args.key)) {
			throw new Error(`Key "${args.key}" is managed by a dedicated endpoint`);
		}

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
