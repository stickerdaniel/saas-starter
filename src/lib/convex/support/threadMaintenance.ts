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
	await ctx.db.patch(supportThread._id, {
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

export async function syncUserProfile(
	ctx: MutationCtx,
	args: { userId: string; userName?: string; userEmail?: string }
): Promise<void> {
	// Bounded: per-user index scan; one user's support-thread count is small.
	const supportThreads = await ctx.db
		.query('supportThreads')
		.withIndex('by_user', (q) => q.eq('userId', args.userId))
		.collect();

	for (const supportThread of supportThreads) {
		await ctx.db.patch(supportThread._id, {
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
}

export async function backfillThreadMetadata(
	ctx: MutationCtx
): Promise<{ updated: number; total: number }> {
	// One-time pre-release backfill; the supportThreads table is bounded here.
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

		await ctx.db.patch(supportThread._id, {
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

		await ctx.db.delete(supportThread._id);
		deleted++;
	}

	if (deleted > 0) console.log(`[deleteEmptyThreads] Deleted ${deleted} empty threads`);
	return { deleted };
}
