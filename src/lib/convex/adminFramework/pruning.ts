import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';

/**
 * Default retention period: 90 days in milliseconds.
 */
const DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Maximum documents to delete per transaction batch.
 * Convex mutations have transaction size limits; 100 docs per batch keeps
 * each transaction well within limits.
 */
const BATCH_SIZE = 100;

/**
 * Prune old admin audit log entries (adminAuditLogs table).
 *
 * Uses the `by_timestamp` index to efficiently find entries older than
 * the retention period. Deletes up to BATCH_SIZE docs per invocation.
 * If more remain, self-schedules a continuation via ctx.scheduler.runAfter(0, ...).
 *
 * Scheduling from mutations is atomic (part of the transaction) and
 * scheduled mutations have exactly-once execution guarantees.
 */
export const pruneAdminAuditLogs = internalMutation({
	args: {
		retentionMs: v.optional(v.number()),
		dryRun: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const retentionMs = args.retentionMs ?? DEFAULT_RETENTION_MS;
		const dryRun = args.dryRun ?? false;
		const cutoff = Date.now() - retentionMs;

		const staleEntries = await ctx.db
			.query('adminAuditLogs')
			.withIndex('by_timestamp', (q) => q.lt('timestamp', cutoff))
			.take(BATCH_SIZE);

		if (staleEntries.length === 0) {
			console.log('[pruneAdminAuditLogs] No stale entries found');
			return { deleted: 0, hasMore: false, dryRun };
		}

		if (!dryRun) {
			for (const entry of staleEntries) {
				await ctx.db.delete(entry._id);
			}
		}

		const hasMore = staleEntries.length === BATCH_SIZE;
		console.log(
			`[pruneAdminAuditLogs] ${dryRun ? '(dry run) ' : ''}Deleted ${staleEntries.length} entries, hasMore=${hasMore}`
		);

		// Self-schedule continuation if more remain
		if (hasMore && !dryRun) {
			await ctx.scheduler.runAfter(0, internal.adminFramework.pruning.pruneAdminAuditLogs, {
				retentionMs,
				dryRun
			});
		}

		return { deleted: staleEntries.length, hasMore, dryRun };
	}
});

/**
 * Prune old resource audit log entries (adminResourceAuditLogs table).
 *
 * Uses the `by_timestamp` index. Same batch-and-continue pattern as above.
 */
export const pruneResourceAuditLogs = internalMutation({
	args: {
		retentionMs: v.optional(v.number()),
		dryRun: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const retentionMs = args.retentionMs ?? DEFAULT_RETENTION_MS;
		const dryRun = args.dryRun ?? false;
		const cutoff = Date.now() - retentionMs;

		const staleEntries = await ctx.db
			.query('adminResourceAuditLogs')
			.withIndex('by_timestamp', (q) => q.lt('timestamp', cutoff))
			.take(BATCH_SIZE);

		if (staleEntries.length === 0) {
			console.log('[pruneResourceAuditLogs] No stale entries found');
			return { deleted: 0, hasMore: false, dryRun };
		}

		if (!dryRun) {
			for (const entry of staleEntries) {
				await ctx.db.delete(entry._id);
			}
		}

		const hasMore = staleEntries.length === BATCH_SIZE;
		console.log(
			`[pruneResourceAuditLogs] ${dryRun ? '(dry run) ' : ''}Deleted ${staleEntries.length} entries, hasMore=${hasMore}`
		);

		if (hasMore && !dryRun) {
			await ctx.scheduler.runAfter(0, internal.adminFramework.pruning.pruneResourceAuditLogs, {
				retentionMs,
				dryRun
			});
		}

		return { deleted: staleEntries.length, hasMore, dryRun };
	}
});

/**
 * Prune old admin notifications (adminNotifications table).
 *
 * Uses the `by_created` index. Same batch-and-continue pattern.
 */
export const pruneAdminNotifications = internalMutation({
	args: {
		retentionMs: v.optional(v.number()),
		dryRun: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const retentionMs = args.retentionMs ?? DEFAULT_RETENTION_MS;
		const dryRun = args.dryRun ?? false;
		const cutoff = Date.now() - retentionMs;

		const staleEntries = await ctx.db
			.query('adminNotifications')
			.withIndex('by_created', (q) => q.lt('createdAt', cutoff))
			.take(BATCH_SIZE);

		if (staleEntries.length === 0) {
			console.log('[pruneAdminNotifications] No stale entries found');
			return { deleted: 0, hasMore: false, dryRun };
		}

		if (!dryRun) {
			for (const entry of staleEntries) {
				await ctx.db.delete(entry._id);
			}
		}

		const hasMore = staleEntries.length === BATCH_SIZE;
		console.log(
			`[pruneAdminNotifications] ${dryRun ? '(dry run) ' : ''}Deleted ${staleEntries.length} entries, hasMore=${hasMore}`
		);

		if (hasMore && !dryRun) {
			await ctx.scheduler.runAfter(0, internal.adminFramework.pruning.pruneAdminNotifications, {
				retentionMs,
				dryRun
			});
		}

		return { deleted: staleEntries.length, hasMore, dryRun };
	}
});
