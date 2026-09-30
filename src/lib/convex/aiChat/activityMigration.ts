import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import { getAiChatSidebarActivityAt } from './visibility';

// Pace byte-bounded pages below the backend's write-rate budget.
const PAGE_DELAY_MS = 250;

const progressValidator = v.object({
	version: v.literal(1),
	status: v.union(v.literal('running'), v.literal('complete')),
	processed: v.number()
});

export const start = internalMutation({
	args: { restart: v.optional(v.boolean()) },
	returns: progressValidator,
	handler: async (ctx, args) => {
		const existing = await ctx.db.query('aiChatHistoryMigration').first();
		if (existing && (existing.status === 'running' || !args.restart)) {
			if (existing.status === 'running') {
				const job = existing.scheduledFnId ? await ctx.db.system.get(existing.scheduledFnId) : null;
				if (!job || (job.state.kind !== 'pending' && job.state.kind !== 'inProgress')) {
					const scheduledFnId = await ctx.scheduler.runAfter(
						PAGE_DELAY_MS,
						internal.aiChat.activityMigration.runPage,
						{ id: existing._id, cursor: existing.cursor }
					);
					await ctx.db.patch('aiChatHistoryMigration', existing._id, { scheduledFnId });
				}
			}
			return { version: existing.version, status: existing.status, processed: existing.processed };
		}
		// A fresh checkpoint ID fences callbacks from an earlier writer rollout.
		if (existing) await ctx.db.delete('aiChatHistoryMigration', existing._id);
		const hasRows = (await ctx.db.query('aiChatThreads').first()) !== null;
		const status = hasRows ? ('running' as const) : ('complete' as const);
		const id = await ctx.db.insert('aiChatHistoryMigration', {
			version: 1,
			status,
			cursor: null,
			processed: 0
		});
		if (hasRows) {
			const scheduledFnId = await ctx.scheduler.runAfter(
				PAGE_DELAY_MS,
				internal.aiChat.activityMigration.runPage,
				{ id, cursor: null }
			);
			await ctx.db.patch('aiChatHistoryMigration', id, { scheduledFnId });
		}
		return { version: 1 as const, status, processed: 0 };
	}
});

export const status = internalQuery({
	args: {},
	returns: v.union(progressValidator, v.null()),
	handler: async (ctx) => {
		const state = await ctx.db.query('aiChatHistoryMigration').first();
		return state
			? { version: state.version, status: state.status, processed: state.processed }
			: null;
	}
});

export const runPage = internalMutation({
	args: { id: v.id('aiChatHistoryMigration'), cursor: v.union(v.string(), v.null()) },
	returns: v.null(),
	handler: async (ctx, args) => {
		const state = await ctx.db.get('aiChatHistoryMigration', args.id);
		if (!state || state.status !== 'running' || state.cursor !== args.cursor) return null;
		const result = await ctx.db.query('aiChatThreads').paginate({
			cursor: args.cursor,
			numItems: 100,
			maximumBytesRead: 512 * 1024
		});
		// At most 100 rows and 512 KiB per page bound these sequential patches.
		for (const row of result.page) {
			const sidebarActivityAt = getAiChatSidebarActivityAt(row);
			if (row.sidebarActivityAt !== sidebarActivityAt) {
				await ctx.db.patch('aiChatThreads', row._id, { sidebarActivityAt });
			}
		}
		const cursor = result.continueCursor;
		const scheduledFnId = result.isDone
			? undefined
			: await ctx.scheduler.runAfter(PAGE_DELAY_MS, internal.aiChat.activityMigration.runPage, {
					id: args.id,
					cursor
				});
		await ctx.db.patch('aiChatHistoryMigration', args.id, {
			cursor,
			processed: state.processed + result.page.length,
			status: result.isDone ? 'complete' : 'running',
			scheduledFnId
		});
		return null;
	}
});
