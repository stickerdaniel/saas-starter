import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { BetterAuthUser } from '../admin/types';

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
 * Recalculate all counters from the actual user data.
 * Use when counters have drifted (e.g. after bulk deletes that bypassed auth triggers).
 */
export async function recalculateCounters(ctx: MutationCtx): Promise<{
	totalUsers: number;
	adminCount: number;
	bannedCount: number;
}> {
	// Fetch all users from the BetterAuth component
	const allUsers: BetterAuthUser[] = [];
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const result: { page: Record<string, unknown>[]; isDone: boolean; continueCursor: string } =
			await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				paginationOpts: { cursor, numItems: 200 }
			});
		for (const user of result.page) {
			allUsers.push(user as unknown as BetterAuthUser);
		}
		hasMore = !result.isDone;
		cursor = result.continueCursor;
	}

	const computed = {
		totalUsers: allUsers.length,
		adminCount: allUsers.filter((u) => u.role === 'admin').length,
		bannedCount: allUsers.filter((u) => u.banned === true).length
	};

	const doc = await ctx.db.query('dashboardCounters').first();
	if (doc) {
		await ctx.db.patch(doc._id, computed);
	} else {
		await ctx.db.insert('dashboardCounters', computed);
	}

	return computed;
}
