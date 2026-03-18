import { internalMutation, type MutationCtx, type QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { parseBetterAuthUsers } from './types';

type AdapterFindManyResult = {
	page: unknown[];
	isDone: boolean;
	continueCursor: string | null;
};

const COUNTER_DEFAULTS: Omit<Doc<'dashboardCounters'>, '_id' | '_creationTime'> = {
	totalUsers: 0,
	adminCount: 0,
	bannedCount: 0
};

type CounterField = keyof typeof COUNTER_DEFAULTS;

/**
 * Read the dashboard counters singleton, returning defaults if it doesn't exist yet.
 */
export async function getCounters(
	ctx: QueryCtx
): Promise<Omit<Doc<'dashboardCounters'>, '_id' | '_creationTime'>> {
	const doc = await ctx.db.query('dashboardCounters').first();
	if (!doc) {
		return { ...COUNTER_DEFAULTS };
	}
	return {
		totalUsers: doc.totalUsers,
		adminCount: doc.adminCount,
		bannedCount: doc.bannedCount
	};
}

/**
 * Atomically increment (or decrement with negative delta) a counter field
 * on the singleton. Creates the singleton if it doesn't exist.
 */
export async function incrementCounter(
	ctx: MutationCtx,
	field: CounterField,
	delta: number
): Promise<void> {
	const doc = await ctx.db.query('dashboardCounters').first();
	if (doc) {
		await ctx.db.patch(doc._id, { [field]: doc[field] + delta });
	} else {
		// First write — initialise with defaults then apply delta
		await ctx.db.insert('dashboardCounters', {
			...COUNTER_DEFAULTS,
			[field]: COUNTER_DEFAULTS[field] + delta
		});
	}
}

/**
 * One-time backfill: count all current users and create/overwrite the singleton.
 *
 * Run via `bun convex run admin.counters:backfillCounters` to initialise.
 */
export const backfillCounters = internalMutation({
	args: {},
	returns: v.object({
		totalUsers: v.number(),
		adminCount: v.number(),
		bannedCount: v.number()
	}),
	handler: async (ctx) => {
		// Enumerate all users from the BetterAuth component
		let totalUsers = 0;
		let adminCount = 0;
		let bannedCount = 0;
		let cursor: string | null = null;

		for (let page = 0; page < 500; page++) {
			const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor, numItems: 200 }
			})) as AdapterFindManyResult;

			const users = parseBetterAuthUsers(result.page);
			totalUsers += users.length;
			adminCount += users.filter((u) => u.role === 'admin').length;
			bannedCount += users.filter((u) => u.banned === true).length;

			if (result.isDone || !result.continueCursor) break;
			cursor = result.continueCursor;
		}

		const counters = { totalUsers, adminCount, bannedCount };

		// Upsert the singleton
		const existing = await ctx.db.query('dashboardCounters').first();
		if (existing) {
			await ctx.db.patch(existing._id, counters);
		} else {
			await ctx.db.insert('dashboardCounters', counters);
		}

		return counters;
	}
});
