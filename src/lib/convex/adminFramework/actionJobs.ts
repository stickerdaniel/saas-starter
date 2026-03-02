import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { adminQuery, adminMutation } from '../functions';
import { sendAdminNotification } from './utils/send_notification';
import { getActionDispatcher } from './utils/action_dispatch';

const DEFAULT_CHUNK_SIZE = 50;

function chunkArray<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

/**
 * Enqueue a background action job.
 * Splits recordIds into chunks and schedules each via ctx.scheduler.runAfter.
 */
export const enqueueActionJob = adminMutation({
	args: {
		actionName: v.string(),
		resourceName: v.string(),
		recordIds: v.array(v.string()),
		actionValues: v.optional(v.any()),
		chunkSize: v.optional(v.number()),
		notifyOnComplete: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const chunkSize = args.chunkSize ?? DEFAULT_CHUNK_SIZE;
		const chunks = chunkArray(args.recordIds, chunkSize);
		const totalChunks = Math.max(chunks.length, 1);
		const now = Date.now();

		const jobId = await ctx.db.insert('adminActionJobs', {
			actionName: args.actionName,
			resourceName: args.resourceName,
			recordIds: args.recordIds,
			actionValues: args.actionValues,
			totalChunks,
			chunkSize,
			status: 'pending',
			processedChunks: 0,
			processedIds: 0,
			failedIds: 0,
			chunkErrors: [],
			adminUserId: ctx.user._id,
			adminEmail: ctx.user.email,
			startedAt: now,
			notifyOnComplete: args.notifyOnComplete ?? true
		});

		// All chunks are scheduled at once. Cancellation is best-effort: already-running
		// mutations cannot be interrupted (Convex platform limitation), so chunks that
		// started before cancellation will still complete.
		for (let i = 0; i < chunks.length; i++) {
			await ctx.scheduler.runAfter(0, internal.adminFramework.actionJobs.processActionJobChunk, {
				jobId,
				chunkIndex: i,
				chunkIds: chunks[i]
			});
		}

		return { jobId };
	}
});

/**
 * Process a single chunk of a background action job.
 * Internal mutation — scheduled by enqueueActionJob.
 * Convex scheduled mutations are exactly-once.
 */
export const processActionJobChunk = internalMutation({
	args: {
		jobId: v.id('adminActionJobs'),
		chunkIndex: v.number(),
		chunkIds: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) return;

		// If the job has been cancelled, skip processing
		if (job.status === 'cancelled') return;

		// Mark as running on the first chunk to be processed
		if (job.status === 'pending') {
			await ctx.db.patch(args.jobId, { status: 'running' });
		}

		let chunkProcessed = 0;
		let chunkFailed = 0;
		let chunkError: string | undefined;

		try {
			const dispatcher = getActionDispatcher(job.resourceName);
			if (!dispatcher) {
				throw new Error(`No action dispatcher for resource: ${job.resourceName}`);
			}

			for (const recordId of args.chunkIds) {
				try {
					await dispatcher(ctx.db, job.actionName, recordId);
					chunkProcessed++;
				} catch (_err) {
					chunkFailed++;
				}
			}
		} catch (error) {
			chunkError = error instanceof Error ? error.message : 'Unknown error processing chunk';
			chunkFailed = args.chunkIds.length - chunkProcessed;
		}

		// Re-fetch job to get latest state (other chunks may have updated concurrently)
		const freshJob = await ctx.db.get(args.jobId);
		if (!freshJob) return;

		// If cancelled while processing, don't update further
		if (freshJob.status === 'cancelled') return;

		const newProcessedChunks = freshJob.processedChunks + 1;
		const newProcessedIds = freshJob.processedIds + chunkProcessed;
		const newFailedIds = freshJob.failedIds + chunkFailed;

		const existingErrors = freshJob.chunkErrors ?? [];
		const newErrors = chunkError
			? [...existingErrors, { chunkIndex: args.chunkIndex, error: chunkError }]
			: existingErrors;

		const isLastChunk = newProcessedChunks >= freshJob.totalChunks;
		const now = Date.now();

		if (isLastChunk) {
			const finalStatus = newFailedIds > 0 ? ('failed' as const) : ('completed' as const);
			await ctx.db.patch(args.jobId, {
				status: finalStatus,
				processedChunks: newProcessedChunks,
				processedIds: newProcessedIds,
				failedIds: newFailedIds,
				chunkErrors: newErrors.length > 0 ? newErrors : undefined,
				completedAt: now,
				error:
					newFailedIds > 0
						? `${newFailedIds} of ${freshJob.recordIds.length} records failed`
						: undefined
			});

			// Send notification if requested
			if (freshJob.notifyOnComplete) {
				const isSuccess = finalStatus === 'completed';
				await sendAdminNotification({
					db: ctx.db,
					userId: freshJob.adminUserId,
					type: isSuccess ? 'success' : 'error',
					icon: isSuccess ? 'circle-check' : 'circle-alert',
					message: isSuccess
						? 'admin.notifications.queued_action_success'
						: 'admin.notifications.queued_action_failure',
					messageParams: isSuccess
						? {
								action: freshJob.actionName,
								count: newProcessedIds,
								resource: freshJob.resourceName
							}
						: {
								action: freshJob.actionName,
								failures: newFailedIds,
								resource: freshJob.resourceName
							},
					source: 'action',
					sourceResourceName: freshJob.resourceName
				});
			}
		} else {
			await ctx.db.patch(args.jobId, {
				processedChunks: newProcessedChunks,
				processedIds: newProcessedIds,
				failedIds: newFailedIds,
				chunkErrors: newErrors.length > 0 ? newErrors : undefined
			});
		}
	}
});

/**
 * Cancel a running/pending action job.
 */
export const cancelActionJob = adminMutation({
	args: { jobId: v.id('adminActionJobs') },
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) throw new Error('Job not found');
		if (job.adminUserId !== ctx.user._id) throw new Error('Unauthorized');
		if (job.status !== 'pending' && job.status !== 'running') {
			throw new Error('Job cannot be cancelled');
		}
		await ctx.db.patch(args.jobId, {
			status: 'cancelled',
			cancelledAt: Date.now()
		});
	}
});

/**
 * Get a single action job by ID.
 */
export const getActionJob = adminQuery({
	args: { jobId: v.id('adminActionJobs') },
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job) throw new Error('Job not found');
		if (job.adminUserId !== ctx.user._id) throw new Error('Unauthorized');
		return job;
	}
});

/**
 * List action jobs for the current admin user, most recent first.
 */
export const listActionJobs = adminQuery({
	args: {
		cursor: v.optional(v.string()),
		numItems: v.number()
	},
	handler: async (ctx, args) => {
		const userId = ctx.user._id;
		const numItems = Math.min(args.numItems, 50);

		const result = await ctx.db
			.query('adminActionJobs')
			.withIndex('by_admin', (q) => q.eq('adminUserId', userId))
			.order('desc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems
			});

		return {
			items: result.page,
			continueCursor: result.continueCursor,
			isDone: result.isDone
		};
	}
});

/**
 * Count active (pending + running) action jobs for the current admin user.
 */
export const countActiveActionJobs = adminQuery({
	args: {},
	handler: async (ctx) => {
		const userId = ctx.user._id;

		// Count pending jobs
		const pending = await ctx.db
			.query('adminActionJobs')
			.withIndex('by_admin_status', (q) => q.eq('adminUserId', userId).eq('status', 'pending'))
			.collect();

		// Count running jobs
		const running = await ctx.db
			.query('adminActionJobs')
			.withIndex('by_admin_status', (q) => q.eq('adminUserId', userId).eq('status', 'running'))
			.collect();

		return pending.length + running.length;
	}
});
