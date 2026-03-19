import { type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';

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
