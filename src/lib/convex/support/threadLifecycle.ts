import type { MutationCtx, QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { t, extractLocaleFromUrl } from '../i18n/translations';
import { buildSupportMessageDenormalization, buildSupportSearchText } from './denormalization';
import type { SupportLatestThreadMessage } from './denormalization';
import { supportAgent } from './agent';
import { supportRateLimiter } from './rateLimit';
import { createRateLimitError } from './types';

export async function limitSupportThreadCreate(
	ctx: MutationCtx,
	owner: { ownerId: string; isAnonymous: boolean },
	pageUrl?: string
): Promise<void> {
	const limitName = owner.isAnonymous ? 'supportThreadCreateAnon' : 'supportThreadCreate';
	const key = owner.isAnonymous ? 'anonymous-global' : owner.ownerId;
	const status = await supportRateLimiter.limit(ctx, limitName, { key });
	if (!status.ok) {
		// Anonymous callers share a global bucket, so exhaustion is high demand,
		// not the visitor's own message rate.
		const messageKey = owner.isAnonymous
			? 'backend.support.rate_limit.global'
			: 'backend.support.rate_limit.user';
		throw createRateLimitError(status.retryAfter, t(extractLocaleFromUrl(pageUrl), messageKey));
	}
}

export async function getLatestCompletedThreadMessage(
	ctx: QueryCtx,
	threadId: string
): Promise<SupportLatestThreadMessage | undefined> {
	const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
		threadId,
		order: 'desc',
		statuses: ['success'],
		excludeToolMessages: true,
		paginationOpts: { numItems: 1, cursor: null }
	});

	return messages.page[0] as SupportLatestThreadMessage | undefined;
}

export async function getSupportOwnerProfile(
	ctx: QueryCtx | MutationCtx,
	resolvedUserId: string,
	isAnonymous: boolean
): Promise<{ userName?: string; userEmail?: string }> {
	if (isAnonymous) {
		return { userName: undefined, userEmail: undefined };
	}

	try {
		const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', operator: 'eq', value: resolvedUserId }],
			select: ['name', 'email']
		});
		if (user) {
			return { userName: user.name, userEmail: user.email };
		}
	} catch (error) {
		console.log(`[supportThreads] Failed to fetch user ${resolvedUserId}:`, error);
	}

	return { userName: undefined, userEmail: undefined };
}

export async function createSupportThreadRecord(
	ctx: MutationCtx,
	args: {
		resolvedUserId: string;
		isAnonymous: boolean;
		title: string;
		summary: string;
		pageUrl?: string;
		isWarm?: boolean;
		awaitingAdminResponse: boolean;
	}
): Promise<{ threadId: string; notificationEmail?: string }> {
	const { threadId } = await supportAgent.createThread(ctx, {
		userId: args.resolvedUserId,
		title: args.title,
		summary: args.summary
	});

	const { userName, userEmail } = await getSupportOwnerProfile(
		ctx,
		args.resolvedUserId,
		args.isAnonymous
	);
	const now = Date.now();

	await ctx.db.insert('supportThreads', {
		threadId,
		userId: args.resolvedUserId,
		isWarm: args.isWarm,
		status: 'open',
		isHandedOff: false,
		awaitingAdminResponse: args.awaitingAdminResponse,
		assignedTo: undefined,
		priority: undefined,
		pageUrl: args.pageUrl || undefined,
		createdAt: now,
		updatedAt: now,
		notificationEmail: userEmail,
		searchText: buildSupportSearchText({
			title: args.title,
			summary: args.summary,
			userName,
			userEmail
		}),
		title: args.title,
		summary: args.summary,
		lastMessage: undefined,
		lastMessageAt: undefined,
		lastMessageRole: undefined,
		lastAgentName: undefined,
		userName,
		userEmail
	});

	return { threadId, notificationEmail: userEmail };
}

export async function syncSupportLastMessage(ctx: MutationCtx, threadId: string): Promise<void> {
	const supportThread = await ctx.db
		.query('supportThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', threadId))
		.first();

	if (!supportThread) {
		console.log(`[syncLastMessage] No supportThread found for: ${threadId}`);
		return;
	}

	const latestMessage = await getLatestCompletedThreadMessage(ctx, threadId);
	const patch = buildSupportMessageDenormalization({
		title: supportThread.title,
		summary: supportThread.summary,
		userName: supportThread.userName,
		userEmail: supportThread.userEmail,
		latestMessage
	});

	await ctx.db.patch(supportThread._id, { ...patch, updatedAt: Date.now() });
}
