import type { MutationCtx, QueryCtx } from '../_generated/server';
import { components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
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

/** Candidate threads one sweep transaction reads. */
const EMPTY_THREAD_SWEEP_BATCH_SIZE = 8;

// Against the 16 MiB transaction limit: the candidate page stops at most one
// document (1 MiB) past this cap, each row's patch or delete reads it again, and
// each row's message lookup reads at most one agent message (1 MiB). That is at
// most 2 + 2 + 8 MiB, leaving room for the component's deletion start.
const EMPTY_THREAD_SWEEP_MAX_BYTES = 1024 * 1024;

/** Attempts per thread before the sweep gives up on it and logs once. */
export const EMPTY_THREAD_SWEEP_MAX_ATTEMPTS = 5;

/** Wait before the first retry; each further retry doubles it. */
const EMPTY_THREAD_SWEEP_RETRY_MS = 60 * 60 * 1000;

export type EmptyThreadSweep = {
	scanned: number;
	retained: number;
	deletionsStarted: number;
	failed: number;
};

type SweepOutcome = 'retained' | 'deletionStarted' | 'failed';

/**
 * Records a failed lookup or deletion. The thread leaves the candidate set and
 * gets its own retry when it is due, so it never blocks later candidates; after
 * the last attempt it stays `failed` and is logged once.
 */
async function recordSweepFailure(
	ctx: MutationCtx,
	supportThread: Doc<'supportThreads'>
): Promise<SweepOutcome> {
	const attempts = (supportThread.sweepAttempts ?? 0) + 1;
	await ctx.db.patch('supportThreads', supportThread._id, {
		sweep: 'failed',
		sweepAttempts: attempts
	});
	if (attempts >= EMPTY_THREAD_SWEEP_MAX_ATTEMPTS) {
		console.warn('[deleteEmptyThreads] Gave up on a support thread', {
			supportThreadId: supportThread._id,
			attempts
		});
	} else {
		await ctx.scheduler.runAt(
			Date.now() + EMPTY_THREAD_SWEEP_RETRY_MS * 2 ** (attempts - 1),
			internal.support.threads.retryEmptyThreadSweep,
			{ supportThreadId: supportThread._id, attempt: attempts }
		);
	}
	return 'failed';
}

/** Keeps a thread that has messages, starts deleting an empty one. */
async function sweepThread(
	ctx: MutationCtx,
	supportThread: Doc<'supportThreads'>
): Promise<SweepOutcome> {
	let messages;
	try {
		messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: supportThread.threadId,
			order: 'asc',
			paginationOpts: { numItems: 1, cursor: null }
		});
	} catch {
		return await recordSweepFailure(ctx, supportThread);
	}
	if (messages.page.length > 0) {
		await ctx.db.patch('supportThreads', supportThread._id, { sweep: 'retained' });
		return 'retained';
	}

	try {
		// Starts the component's deletion; it removes the thread's data in its own
		// scheduled pages.
		await supportAgent.deleteThreadAsync(ctx, { threadId: supportThread.threadId });
	} catch {
		return await recordSweepFailure(ctx, supportThread);
	}
	await ctx.db.delete('supportThreads', supportThread._id);
	return 'deletionStarted';
}

/**
 * Deletes support threads older than 24 h whose agent thread has no messages,
 * one page of candidates per cron run.
 *
 * Every thread the sweep reads leaves the candidate set: one with messages
 * becomes `retained`, an empty one is deleted, and one whose lookup or deletion
 * throws becomes `failed` with its own scheduled retry. The next run therefore
 * starts at the remaining candidates without a stored cursor, and runs never
 * schedule each other, so only the cron drives the walk.
 */
export async function deleteEmptyThreads(ctx: MutationCtx): Promise<EmptyThreadSweep> {
	const sweep: EmptyThreadSweep = { scanned: 0, retained: 0, deletionsStarted: 0, failed: 0 };
	const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
	// A page cut short by the byte cap is still safe to process: its rows leave
	// the range, and the rest wait for the next run.
	const { page } = await ctx.db
		.query('supportThreads')
		.withIndex('by_sweep', (q) => q.eq('sweep', undefined).lt('_creationTime', cutoffTime))
		.paginate({
			numItems: EMPTY_THREAD_SWEEP_BATCH_SIZE,
			cursor: null,
			maximumBytesRead: EMPTY_THREAD_SWEEP_MAX_BYTES
		});

	for (const supportThread of page) {
		sweep.scanned++;
		const outcome = await sweepThread(ctx, supportThread);
		if (outcome === 'retained') sweep.retained++;
		else if (outcome === 'deletionStarted') sweep.deletionsStarted++;
		else sweep.failed++;
	}

	if (sweep.scanned > 0) console.log('[deleteEmptyThreads] Swept support threads', sweep);
	return sweep;
}

/**
 * Retries one failed thread. Only the retry its latest failure scheduled acts;
 * a thread deleted, retained or failed again since then has moved on.
 */
export async function retryEmptyThreadSweep(
	ctx: MutationCtx,
	args: { supportThreadId: Id<'supportThreads'>; attempt: number }
): Promise<void> {
	const supportThread = await ctx.db.get('supportThreads', args.supportThreadId);
	if (!supportThread || supportThread.sweep !== 'failed') return;
	if (supportThread.sweepAttempts !== args.attempt) return;
	await sweepThread(ctx, supportThread);
}
