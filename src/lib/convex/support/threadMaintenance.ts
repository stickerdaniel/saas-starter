import type { MutationCtx, QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { extractLocaleFromUrl } from '../i18n/translations';
import { isAnonymousUser } from '../utils/anonymousUser';
import { supportAgent } from './agent';
import { buildSupportMessageDenormalization, buildSupportSearchText } from './denormalization';
import { getLatestCompletedThreadMessage, getSupportOwnerProfile } from './threadLifecycle';

export async function updateThreadMetadata(
	ctx: MutationCtx,
	args: { threadId: string; title?: string; summary?: string }
): Promise<void> {
	const supportThread = await ctx.db
		.query('supportThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
		.first();

	if (!supportThread) {
		console.log(`[syncThreadMetadata] No supportThread found for: ${args.threadId}`);
		return;
	}

	const title = args.title ?? supportThread.title;
	const summary = args.summary ?? supportThread.summary;
	await ctx.db.patch('supportThreads', supportThread._id, {
		title,
		summary,
		searchText: buildSupportSearchText({
			title,
			summary,
			lastMessage: supportThread.lastMessage,
			userName: supportThread.userName,
			userEmail: supportThread.userEmail
		}),
		updatedAt: Date.now()
	});
}

/**
 * Threads one transaction rewrites for a single user. A user's thread count is
 * rate-limited but not capped, so callers schedule the next page instead of
 * reading them all.
 */
export const SUPPORT_THREAD_BATCH_SIZE = 100;

// Each patch reads its thread again, so a page reads at most a quarter of the
// 16 MiB transaction read limit and leaves room for those re-reads.
const SUPPORT_THREAD_PAGE_MAX_BYTES = 4 * 1024 * 1024;

/** A range of one user's threads still to rewrite, scheduled as its own transaction. */
export type SupportThreadRange = { cursor?: string; endCursor?: string };

export async function syncUserProfile(
	ctx: MutationCtx,
	args: { userId: string; userName?: string; userEmail?: string } & SupportThreadRange
): Promise<{ next: SupportThreadRange[] }> {
	const { page, isDone, continueCursor, pageStatus, splitCursor } = await ctx.db
		.query('supportThreads')
		.withIndex('by_user_warm', (q) => q.eq('userId', args.userId))
		.paginate({
			numItems: SUPPORT_THREAD_BATCH_SIZE,
			cursor: args.cursor ?? null,
			endCursor: args.endCursor ?? null,
			maximumBytesRead: SUPPORT_THREAD_PAGE_MAX_BYTES
		});

	// Past the byte cap the page may be incomplete, and continuing from
	// `continueCursor` would skip the missing threads. Rewrite nothing here and
	// schedule the two halves instead, as Convex's pagination contract prescribes.
	if (pageStatus === 'SplitRequired' && splitCursor) {
		return {
			next: [
				{ cursor: args.cursor, endCursor: splitCursor },
				{ cursor: splitCursor, endCursor: args.endCursor }
			]
		};
	}

	for (const supportThread of page) {
		await ctx.db.patch('supportThreads', supportThread._id, {
			userName: args.userName,
			userEmail: args.userEmail,
			searchText: buildSupportSearchText({
				title: supportThread.title,
				summary: supportThread.summary,
				lastMessage: supportThread.lastMessage,
				userName: args.userName,
				userEmail: args.userEmail
			})
		});
	}

	// A range with an end was fully covered by this page.
	if (args.endCursor !== undefined || isDone) return { next: [] };
	return { next: [{ cursor: continueCursor }] };
}

export async function backfillThreadMetadata(
	ctx: MutationCtx
): Promise<{ updated: number; total: number }> {
	// eslint-disable-next-line @convex-dev/no-collect-in-query -- Manual one-time backfill for pre-release data; the table grows per user, so past the read limit this mutation fails whole instead of skipping rows
	const supportThreads = await ctx.db.query('supportThreads').collect();
	let updated = 0;

	for (const supportThread of supportThreads) {
		let agentThread;
		try {
			agentThread = await ctx.runQuery(components.agent.threads.getThread, {
				threadId: supportThread.threadId
			});
		} catch {
			continue;
		}

		if (!agentThread) continue;
		const { userName, userEmail } = await getSupportOwnerProfile(
			ctx,
			supportThread.userId,
			isAnonymousUser(supportThread.userId)
		);

		await ctx.db.patch('supportThreads', supportThread._id, {
			title: agentThread.title,
			summary: agentThread.summary,
			userName,
			userEmail,
			...buildSupportMessageDenormalization({
				title: agentThread.title,
				summary: agentThread.summary,
				userName,
				userEmail,
				latestMessage: await getLatestCompletedThreadMessage(ctx, supportThread.threadId)
			})
		});
		updated++;
	}

	return { updated, total: supportThreads.length };
}

export async function getThreadLocale(ctx: QueryCtx, threadId: string): Promise<string> {
	const supportThread = await ctx.db
		.query('supportThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', threadId))
		.first();
	return extractLocaleFromUrl(supportThread?.pageUrl);
}

/** Rows one empty-thread sweep transaction reads per step. */
const EMPTY_THREAD_SWEEP_BATCH_SIZE = 25;

// A step's page stops at most one document (1 MiB) past this cap, and each row
// is read again by its patch or delete, so the requeue and candidate steps
// together read at most 12 MiB of supportThreads. This bounds only this table:
// the 25 one-message lookups and deletion starts in the agent component come on
// top and are not capped here.
const EMPTY_THREAD_SWEEP_MAX_BYTES = 2 * 1024 * 1024;

export type EmptyThreadSweep = {
	scanned: number;
	retained: number;
	deletionsStarted: number;
	failed: number;
	requeued: number;
};

/**
 * Deletes support threads older than 24 h whose agent thread has no messages,
 * one page of candidates per transaction.
 *
 * Every row the sweep reads leaves the candidate set: a thread with messages
 * becomes `retained`, an empty one is deleted, and one whose deletion throws
 * becomes `failed` until a cron run puts it back (`continuation` skips that
 * requeue). Each requeue takes the rows that failed longest ago, so failures that
 * keep failing cannot hold a later one back. The caller schedules a continuation while `hasMore` is true.
 *
 * A cron run can start while a continuation is still pending, so two chains may
 * overlap. That stays bounded: every committed page changes the state of each
 * row it read, so both chains drain the same finite candidate set and each
 * schedules a follow-up only after a page that consumed rows.
 */
export async function deleteEmptyThreads(
	ctx: MutationCtx,
	args: { continuation: boolean }
): Promise<{ sweep: EmptyThreadSweep; hasMore: boolean }> {
	const sweep: EmptyThreadSweep = {
		scanned: 0,
		retained: 0,
		deletionsStarted: 0,
		failed: 0,
		requeued: 0
	};

	if (!args.continuation) {
		const { page: failedThreads } = await ctx.db
			.query('supportThreads')
			.withIndex('by_sweep', (q) => q.eq('sweep', 'failed'))
			.paginate({
				numItems: EMPTY_THREAD_SWEEP_BATCH_SIZE,
				cursor: null,
				maximumBytesRead: EMPTY_THREAD_SWEEP_MAX_BYTES
			});
		for (const supportThread of failedThreads) {
			await ctx.db.patch('supportThreads', supportThread._id, {
				sweep: undefined,
				sweepFailedAt: undefined
			});
			sweep.requeued++;
		}
	}

	const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
	// Always the first page: processed rows leave the index range, so the next
	// transaction starts from the remaining candidates without a stored cursor.
	// A page cut short by the byte cap is still safe to process for that reason.
	const { page, isDone } = await ctx.db
		.query('supportThreads')
		.withIndex('by_sweep', (q) =>
			q.eq('sweep', undefined).eq('sweepFailedAt', undefined).lt('_creationTime', cutoffTime)
		)
		.paginate({
			numItems: EMPTY_THREAD_SWEEP_BATCH_SIZE,
			cursor: null,
			maximumBytesRead: EMPTY_THREAD_SWEEP_MAX_BYTES
		});

	for (const supportThread of page) {
		sweep.scanned++;
		let messages;
		try {
			messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
				threadId: supportThread.threadId,
				order: 'asc',
				paginationOpts: { numItems: 1, cursor: null }
			});
		} catch {
			// A thread the component cannot read would otherwise fail every run at the
			// head of the range; it waits as `failed` like a deletion that threw.
			await ctx.db.patch('supportThreads', supportThread._id, {
				sweep: 'failed',
				sweepFailedAt: Date.now()
			});
			sweep.failed++;
			continue;
		}
		if (messages.page.length > 0) {
			await ctx.db.patch('supportThreads', supportThread._id, { sweep: 'retained' });
			sweep.retained++;
			continue;
		}

		try {
			// Starts the component's deletion; it removes the thread's data in its own
			// scheduled pages.
			await supportAgent.deleteThreadAsync(ctx, { threadId: supportThread.threadId });
		} catch {
			await ctx.db.patch('supportThreads', supportThread._id, {
				sweep: 'failed',
				sweepFailedAt: Date.now()
			});
			sweep.failed++;
			continue;
		}

		await ctx.db.delete('supportThreads', supportThread._id);
		sweep.deletionsStarted++;
	}

	if (sweep.scanned > 0 || sweep.requeued > 0) {
		console.log('[deleteEmptyThreads] Swept support threads', sweep);
	}
	return { sweep, hasMore: page.length > 0 && !isDone };
}
