import * as Effect from 'effect/Effect';
import type { MutationCtx, QueryCtx } from '../../convex/_generated/server';
import { AiChatRefusal } from '../errorCodecs';
import { AI_CHAT_ERROR_CODES, createAiChatError } from './errors';

type AiChatAccessCtx = QueryCtx | MutationCtx;
type ThreadOwner = { threadId: string; userId: string };

async function ownedRecord(ctx: AiChatAccessCtx, args: ThreadOwner) {
	const record = await ctx.db
		.query('aiChatThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
		.first();
	return record && record.userId === args.userId ? record : null;
}

export async function requireAiChatThreadRecord(ctx: AiChatAccessCtx, args: ThreadOwner) {
	const record = await ownedRecord(ctx, args);
	if (!record) throw createAiChatError(AI_CHAT_ERROR_CODES.threadNotFound);
	return record;
}

export const ownedAiChatThread = (ctx: AiChatAccessCtx, args: ThreadOwner) =>
	Effect.promise(() => ownedRecord(ctx, args)).pipe(
		Effect.flatMap((record) =>
			record
				? Effect.succeed(record)
				: Effect.fail(new AiChatRefusal({ refusal: { code: AI_CHAT_ERROR_CODES.threadNotFound } }))
		)
	);
