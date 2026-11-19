import { type MutationCtx, type QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';

export type CounterValues = Pick<
	Doc<'dashboardCounters'>,
	'totalUsers' | 'adminCount' | 'bannedCount'
>;
type CounterField = keyof CounterValues;

const COUNTER_DEFAULTS: CounterValues = { totalUsers: 0, adminCount: 0, bannedCount: 0 };

/**
 * The counters are spread over SHARD_COUNT rows so that concurrent sign-ups do
 * not all patch one document: Convex retries a conflicting mutation only a few
 * times, and a burst of sign-ups on one row fails with FAILED_TO_CREATE_USER.
 * A write reads and patches one random shard; a read sums every row, including
 * a legacy row without `shard` from before the sharding.
 */
const SHARD_COUNT = 16;
// A repair deletes at most this many rows, far above the 17 a valid table holds.
const REPAIR_ROW_LIMIT = 1000;

function addValues(total: CounterValues, row: CounterValues): CounterValues {
	return {
		totalUsers: total.totalUsers + row.totalUsers,
		adminCount: total.adminCount + row.adminCount,
		bannedCount: total.bannedCount + row.bannedCount
	};
}

/**
 * Sum the dashboard counters over all shards. Throws on a malformed table
 * (a shard outside 0..SHARD_COUNT-1, a duplicate shard, several legacy rows),
 * which `recalculateCounters` repairs. Call it from queries only: a mutation
 * that reads every shard conflicts with every concurrent sign-up.
 */
export async function getCounters(ctx: QueryCtx): Promise<CounterValues> {
	const rows = await ctx.db.query('dashboardCounters').take(SHARD_COUNT + 2);
	const seen = new Set<number | undefined>();
	for (const row of rows) {
		const valid =
			row.shard === undefined ||
			(Number.isInteger(row.shard) && row.shard >= 0 && row.shard < SHARD_COUNT);
		if (!valid || seen.has(row.shard)) {
			throw new Error('dashboardCounters is malformed; run recalculateCounters');
		}
		seen.add(row.shard);
	}
	return rows.reduce(addValues, { ...COUNTER_DEFAULTS });
}

/**
 * Atomically increment (or decrement with negative delta) a counter field on
 * one random shard, creating that shard's row on first use. Two mutations that
 * insert the same missing shard read the same empty index range, so Convex
 * retries the later one, which then patches the new row.
 */
export async function incrementCounter(
	ctx: Pick<MutationCtx, 'db'>,
	field: CounterField,
	delta: number
): Promise<void> {
	const shard = Math.floor(Math.random() * SHARD_COUNT);
	const row = await ctx.db
		.query('dashboardCounters')
		.withIndex('by_shard', (q) => q.eq('shard', shard))
		.unique();
	if (row) {
		await ctx.db.patch('dashboardCounters', row._id, { [field]: row[field] + delta });
	} else {
		await ctx.db.insert('dashboardCounters', {
			...COUNTER_DEFAULTS,
			[field]: delta,
			shard
		});
	}
}

/**
 * Recalculate all counters from the actual user data and rewrite every shard.
 * Use when counters have drifted (e.g. after bulk deletes that bypassed auth triggers)
 * or when `getCounters` reports a malformed table.
 */
export async function recalculateCounters(ctx: MutationCtx): Promise<CounterValues> {
	// Compute counters incrementally while paging (no full-array allocation)
	const computed = { totalUsers: 0, adminCount: 0, bannedCount: 0 };
	let cursor: string | null = null;

	for (let page = 0; page < 500; page++) {
		const result: {
			page: Array<Record<string, unknown>>;
			isDone: boolean;
			continueCursor: string;
		} = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'user',
			paginationOpts: { cursor, numItems: 200 }
		});
		for (const raw of result.page) {
			const user = raw;
			computed.totalUsers++;
			if (user.role === 'admin') computed.adminCount++;
			if (user.banned === true) computed.bannedCount++;
		}
		if (result.isDone || !result.continueCursor) break;
		cursor = result.continueCursor;
	}

	// Replace every row, malformed ones included, in this one transaction: shard 0
	// carries the totals and every other shard exists at zero, so the next burst
	// of sign-ups patches existing rows instead of inserting them.
	const rows = await ctx.db.query('dashboardCounters').take(REPAIR_ROW_LIMIT + 1);
	if (rows.length > REPAIR_ROW_LIMIT) {
		throw new Error(
			`dashboardCounters has more than ${REPAIR_ROW_LIMIT} rows; delete them before recalculating`
		);
	}
	for (const row of rows) {
		await ctx.db.delete('dashboardCounters', row._id);
	}
	for (let shard = 0; shard < SHARD_COUNT; shard++) {
		await ctx.db.insert('dashboardCounters', {
			...(shard === 0 ? computed : COUNTER_DEFAULTS),
			shard
		});
	}

	return computed;
}
