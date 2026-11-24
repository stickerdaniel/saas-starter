import type { MutationCtx } from '../../convex/_generated/server';
import type { Doc } from '../../convex/_generated/dataModel';
import type { PaginationResult } from 'convex/server';
import type { MessageDoc } from '@convex-dev/agent/validators';
import { components } from '../../convex/_generated/api';
import { syncSupportLastMessage } from './threadLifecycle';
import { supportAgent } from './agent';
import { extractLocaleFromUrl, t } from '../i18n/translations';
import type { TurnErrorNameSchema, UnansweredTurnSchema } from './schemas';

export type TurnErrorName = typeof TurnErrorNameSchema.Type;

export type UnansweredTurn = typeof UnansweredTurnSchema.Type;

/**
 * Rows read per page when checking for a reply since the prompt: a turn's own
 * rows (two attempts of at most five steps, agent.ts) and whatever answered it.
 */
const REPLY_LOOKBACK_ROWS = 30;
/**
 * Pages read before giving up on reaching the prompt. The visitor can keep
 * writing to a handed-off thread until the turn settles, so the prompt may sit
 * beyond the first page; past this bound the visitor is acknowledged anyway.
 */
const REPLY_LOOKBACK_PAGES = 10;

/**
 * Acknowledge the visitor on a handed-off thread unless something already
 * answered their message since the prompt: agent text on the prompt's own
 * order, the acknowledgement itself, or a team reply. The acknowledgement covers
 * the widget's handoff button, which writes it before it flips the thread, and
 * an earlier or concurrent recovery of the same turn (mutations reading these
 * rows serialize). Agent text on another order answers a different message,
 * from a second tab, and does not count. Reads back page by page until it
 * passes the prompt's order. Returns whether it wrote the acknowledgement.
 */
export async function acknowledgeUnrepliedTurn(
	ctx: MutationCtx,
	supportThread: Doc<'supportThreads'>,
	promptMessageId: string
): Promise<boolean> {
	const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
		messageIds: [promptMessageId]
	});
	if (!prompt) return false;

	const acknowledgement = handoffAcknowledgement(supportThread);
	const answers = (row: MessageDoc) => {
		const text = row.text?.trim();
		if (!text || row.message?.role !== 'assistant') return false;
		if (row._creationTime <= prompt._creationTime) return false;
		return row.order === prompt.order || row.provider === 'human' || text === acknowledgement;
	};

	let cursor: string | null = null;
	for (let page = 0; page < REPLY_LOOKBACK_PAGES; page++) {
		const latest: PaginationResult<MessageDoc> = await ctx.runQuery(
			components.agent.messages.listMessagesByThreadId,
			{
				threadId: supportThread.threadId,
				order: 'desc',
				paginationOpts: { numItems: REPLY_LOOKBACK_ROWS, cursor }
			}
		);
		if (latest.page.some(answers)) return false;
		// Newest first by order, so a row before the prompt's order ends the search.
		if (latest.isDone || latest.page.some((row) => row.order < prompt.order)) break;
		cursor = latest.continueCursor;
	}

	await saveHandoffAcknowledgement(ctx, supportThread);
	return true;
}

/**
 * The fields of a turn log line. Every value is coded: the thread and prompt are
 * named by their internal ids, never by their content, so a log line leads to
 * the thread, and the status is written only when it is an integer.
 */
export function turnLogFields(
	turn: Partial<UnansweredTurn> & Pick<UnansweredTurn, 'threadId' | 'promptMessageId'>
): Record<string, string | number | boolean> {
	return {
		threadId: turn.threadId,
		promptMessageId: turn.promptMessageId,
		...(turn.reason !== undefined ? { reason: turn.reason } : {}),
		...(turn.attempts !== undefined ? { attempts: turn.attempts } : {}),
		...(turn.visibleText !== undefined ? { visibleText: turn.visibleText } : {}),
		...(turn.errorName !== undefined ? { errorName: turn.errorName } : {}),
		...(turn.status !== undefined && Number.isInteger(turn.status) ? { status: turn.status } : {})
	};
}

export async function findSupportThread(
	ctx: MutationCtx,
	threadId: string
): Promise<Doc<'supportThreads'> | null> {
	return await ctx.db
		.query('supportThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', threadId))
		.first();
}

export async function markHandedOff(
	ctx: MutationCtx,
	supportThread: Doc<'supportThreads'>
): Promise<void> {
	await ctx.db.patch('supportThreads', supportThread._id, {
		isHandedOff: true,
		awaitingAdminResponse: true,
		updatedAt: Date.now()
	});
	await syncSupportLastMessage(ctx, supportThread.threadId);
}

/** The canned sentence telling the visitor the team has their message. */
function handoffAcknowledgement(supportThread: Doc<'supportThreads'>): string {
	return t(extractLocaleFromUrl(supportThread.pageUrl), 'backend.support.handoff.response');
}

export async function saveHandoffAcknowledgement(
	ctx: MutationCtx,
	supportThread: Doc<'supportThreads'>
): Promise<void> {
	await supportAgent.saveMessage(ctx, {
		threadId: supportThread.threadId,
		message: { role: 'assistant', content: handoffAcknowledgement(supportThread) },
		skipEmbeddings: true
	});
}
