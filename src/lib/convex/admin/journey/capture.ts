import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';

/**
 * One row per captured journey source: the time this deployment first wrote
 * one of its facts. `startedAt` means "recorded without known gaps since", so
 * a reader can tell a source that has no history yet from one with no events.
 *
 * Producers insert the row and never update it. Rows are never deleted: an
 * absent row means only that this deployment never captured the source.
 */
export const journeyCaptureStarts = defineTable({
	source: v.string(),
	startedAt: v.number()
}).index('by_source', ['source']);

/**
 * Record that `source` has started capturing, inside the producer's own
 * transaction. The index read makes concurrent first producers conflict, so
 * exactly one of them inserts the row.
 */
export async function ensureCaptureStart(ctx: MutationCtx, source: string): Promise<void> {
	const existing = await ctx.db
		.query('journeyCaptureStarts')
		.withIndex('by_source', (q) => q.eq('source', source))
		.first();
	if (!existing) {
		await ctx.db.insert('journeyCaptureStarts', { source, startedAt: Date.now() });
	}
}
