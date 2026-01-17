import { v } from 'convex/values';
import { adminQuery } from '../../functions';

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
