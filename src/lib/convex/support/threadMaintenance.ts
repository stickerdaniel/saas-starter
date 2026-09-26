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

export async function deleteEmptyThreads(ctx: MutationCtx): Promise<{ deleted: number }> {
	const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
	const oldThreads = await ctx.db
		.query('supportThreads')
		.withIndex('by_creation_time')
		// Intentional: indexed cron cleanup; take(100) bounds each batch.
		// eslint-disable-next-line @convex-dev/no-filter-in-query
		.filter((q) => q.lt(q.field('_creationTime'), cutoffTime))
		.take(100);

	let deleted = 0;
	for (const supportThread of oldThreads) {
		const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: supportThread.threadId,
			order: 'asc',
			paginationOpts: { numItems: 1, cursor: null }
		});
		if (messages.page.length > 0) continue;

		try {
			await supportAgent.deleteThreadAsync(ctx, { threadId: supportThread.threadId });
		} catch (error) {
			console.log(`[deleteEmptyThreads] Failed to delete agent thread: ${String(error)}`);
			continue;
		}

		await ctx.db.delete('supportThreads', supportThread._id);
		deleted++;
	}

	if (deleted > 0) console.log(`[deleteEmptyThreads] Deleted ${deleted} empty threads`);
	return { deleted };
}
