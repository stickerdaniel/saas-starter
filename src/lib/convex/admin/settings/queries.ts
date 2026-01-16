import { v } from 'convex/values';
import { adminQuery } from '../../functions';

/**
 * Admin Settings Keys
 *
 * Use these constants to ensure type-safe setting keys throughout the codebase.
 */
export const ADMIN_SETTING_KEYS = {
	DEFAULT_SUPPORT_EMAIL: 'defaultSupportEmail'
} as const;

/**
 * Type-safe admin setting key union
 *
 * Use this type to ensure only valid setting keys are passed to functions.
 */
export type AdminSettingKey = (typeof ADMIN_SETTING_KEYS)[keyof typeof ADMIN_SETTING_KEYS];

/**
 * Get a single admin setting by key
 *
 * @param args.key - The setting key to retrieve
 * @returns The setting value or null if not found
 */
export const getSetting = adminQuery({
	args: {
		key: v.string()
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const setting = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', args.key))
			.first();

		return setting?.value ?? null;
	}
});

/** Maximum number of settings to return (prevent unbounded growth) */
const MAX_SETTINGS = 100;

/**
 * Get all admin settings
 *
 * @returns Array of all settings with key-value pairs (limited to 100)
 */
export const getAllSettings = adminQuery({
	args: {},
	returns: v.array(
		v.object({
			key: v.string(),
			value: v.string(),
			updatedAt: v.number(),
			updatedBy: v.optional(v.string())
		})
	),
	handler: async (ctx) => {
		const settings = await ctx.db.query('adminSettings').take(MAX_SETTINGS);

		return settings.map((s) => ({
			key: s.key,
			value: s.value,
			updatedAt: s.updatedAt,
			updatedBy: s.updatedBy
		}));
	}
});

/**
 * Get the default support notification email
 *
 * Convenience wrapper for the common use case of getting the default email.
 *
 * @returns The default email or null if not configured
 */
export const getDefaultSupportEmail = adminQuery({
	args: {},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx) => {
		const setting = await ctx.db
			.query('adminSettings')
			.withIndex('by_key', (q) => q.eq('key', ADMIN_SETTING_KEYS.DEFAULT_SUPPORT_EMAIL))
			.first();

		return setting?.value ?? null;
	}
});
