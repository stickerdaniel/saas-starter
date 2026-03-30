import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type AiChatAccessCtx = QueryCtx | MutationCtx;

export async function requireAiChatThreadRecord(
	ctx: AiChatAccessCtx,
	args: {
		threadId: string;
		userId: string;
	}
) {
	const record = await ctx.db
		.query('aiChatThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
		.first();

	if (!record || record.userId !== args.userId) {
		throw new ConvexError('Thread not found');
	}

	return record;
}
