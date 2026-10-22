import { internalMutation, type MutationCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { v, type Infer, type ObjectType } from 'convex/values';
import { components, internal } from '../_generated/api';
import { syncSupportLastMessage } from './threads';
import { supportAgent } from './agent';
import { extractLocaleFromUrl, t } from '../i18n/translations';

/**
 * Internal handoff used by the support agent's request_handoff tool
 * (support/tools/handoff.ts).
 *
 * Mirrors updateThreadHandoff's flag flip, denormalization sync, and admin
 * notification, but skips the canned "Talk to support" / handoff-response
 * messages: the model relays its own message in the same turn, and the
 * threadId is trusted from the agent tool context, so there is no caller to
 * authorize and no button-press text to inject.
 *
 * Kept in its own file rather than in threads.ts so the tool's internal
 * mutation stays separate from the user-facing widget mutation.
 */
export const internalSetHandoff = internalMutation({
	args: {
		threadId: v.string(),
		// Set by a caller that has no model speaking for it. The agent tool leaves
		// it off because the model answers in the same turn; a job the agent
		// switch caught mid-flight has nobody to answer, so it asks for the canned
		// acknowledgement instead and the visitor is not left without a reply.
		// settleUnansweredTurn below always asks for it, for the same reason.
		acknowledge: v.optional(v.boolean())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const supportThread = await findSupportThread(ctx, args.threadId);

		if (!supportThread) {
			console.log(`[internalSetHandoff] No supportThread found for: ${args.threadId}`);
			return null;
		}

		await handOffThread(ctx, supportThread, { acknowledge: args.acknowledge === true });
		return null;
	}
});

/** Why a support agent turn ended without a reply. Coded, so it can be logged. */
const unansweredTurnReasonValidator = v.union(
	v.literal('no_reply'),
	v.literal('partial_reply'),
	v.literal('retry_rate_limited'),
	v.literal('handoff_without_reply'),
	v.literal('job_failed'),
	v.literal('job_missing')
);

/**
 * The only error names a turn log may carry. Anything else a turn throws is
 * logged as `other`: a thrown name is not a coded value until it is listed here,
 * and a provider error's message can carry the visitor's prompt.
 */
const turnErrorNameValidator = v.union(
	v.literal('AbortError'),
	v.literal('TimeoutError'),
	v.literal('APICallError'),
	v.literal('other')
);

export type TurnErrorName = Infer<typeof turnErrorNameValidator>;

const unansweredTurnFields = {
	threadId: v.string(),
	promptMessageId: v.string(),
	reason: unansweredTurnReasonValidator,
	/** Model attempts the turn made; absent when the watchdog settles it. */
	attempts: v.optional(v.number()),
	/** Whether the turn persisted assistant text the visitor may have seen. */
	visibleText: v.optional(v.boolean()),
	errorName: v.optional(turnErrorNameValidator),
	/** HTTP status of a provider failure; logged only when it is an integer. */
	status: v.optional(v.number())
};

export type UnansweredTurn = ObjectType<typeof unansweredTurnFields>;

/**
 * Settle a support agent turn that ended without a reply, and log what it took.
 *
 * Called by createAIResponse through settleUnansweredTurn, and directly by its
 * watchdog (ensureSupportTurnSettled) inside its own transaction, so both
 * callers share one outcome:
 * - A thread still with the agent is handed to the team with the
 *   acknowledgement, and logged as an error. Only the call that flips the
 *   thread logs, so one turn is not logged twice.
 * - A thread already handed off was told to the team by whoever flipped it,
 *   typically the agent's request_handoff with the model then saying nothing.
 *   Only the visitor's acknowledgement can be missing; it is written once and
 *   logged as a warning.
 */
export async function settleUnanswered(ctx: MutationCtx, turn: UnansweredTurn): Promise<void> {
	const supportThread = await findSupportThread(ctx, turn.threadId);
	if (!supportThread) return;

	if (await handOffThread(ctx, supportThread, { acknowledge: true })) {
		console.error({ code: 'support_turn_unanswered', ...turnLogFields(turn) });
		return;
	}

	if (await acknowledgeUnrepliedTurn(ctx, supportThread, turn.promptMessageId)) {
		console.warn({ code: 'support_turn_handoff_without_reply', ...turnLogFields(turn) });
	}
}

/**
 * Rows read back when checking for a reply since the prompt: a turn's own rows
 * (two attempts of at most five steps, agent.ts) and whatever answered it.
 */
const REPLY_LOOKBACK_ROWS = 30;

/**
 * Acknowledge the visitor on a handed-off thread unless something already
 * answered their message since the prompt: agent text on the prompt's own
 * order, the acknowledgement itself, or a team reply. The acknowledgement covers
 * the widget's handoff button, which writes it before it flips the thread, and
 * an earlier or concurrent recovery of the same turn (mutations reading these
 * rows serialize). Agent text on another order answers a different message,
 * from a second tab, and does not count. Returns whether it wrote the
 * acknowledgement.
 */
async function acknowledgeUnrepliedTurn(
	ctx: MutationCtx,
	supportThread: Doc<'supportThreads'>,
	promptMessageId: string
): Promise<boolean> {
	const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
		messageIds: [promptMessageId]
	});
	if (!prompt) return false;

	const acknowledgement = handoffAcknowledgement(supportThread);
	const latest = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
		threadId: supportThread.threadId,
		order: 'desc',
		paginationOpts: { numItems: REPLY_LOOKBACK_ROWS, cursor: null }
	});
	const replied = latest.page.some((row) => {
		const text = row.text?.trim();
		if (!text || row.message?.role !== 'assistant') return false;
		if (row._creationTime <= prompt._creationTime) return false;
		return row.order === prompt.order || row.provider === 'human' || text === acknowledgement;
	});
	if (replied) return false;

	await saveHandoffAcknowledgement(ctx, supportThread);
	return true;
}

/** createAIResponse's entry point to settleUnanswered, which an action cannot call directly. */
export const settleUnansweredTurn = internalMutation({
	args: unansweredTurnFields,
	returns: v.null(),
	handler: async (ctx, args) => {
		await settleUnanswered(ctx, args);
		return null;
	}
});

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

async function findSupportThread(
	ctx: MutationCtx,
	threadId: string
): Promise<Doc<'supportThreads'> | null> {
	return await ctx.db
		.query('supportThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', threadId))
		.first();
}

/**
 * Flip a thread to the team: latch the flag, sync the admin preview, optionally
 * acknowledge the visitor, and announce it as a new ticket. Returns whether this
 * call flipped it; a thread already handed off is left untouched.
 */
async function handOffThread(
	ctx: MutationCtx,
	supportThread: Doc<'supportThreads'>,
	options: { acknowledge: boolean }
): Promise<boolean> {
	if (supportThread.isHandedOff) return false;

	const { threadId } = supportThread;

	// Mark as handed off - user is waiting for admin response
	await ctx.db.patch('supportThreads', supportThread._id, {
		isHandedOff: true,
		awaitingAdminResponse: true,
		updatedAt: Date.now()
	});

	// Keep denormalized search fields in sync
	await syncSupportLastMessage(ctx, threadId);

	// Notify admins that a human needs to pick up this thread (same path as the
	// widget handoff button). A handoff with no prior user messages still
	// schedules the notification; the email renders a no-messages fallback.
	//
	// Read before any acknowledgement is written: the query keeps the newest
	// 50 entries of any role and filters afterwards, so the canned sentence
	// would take a slot and could push the oldest report out of the window.
	const recentMessageIds = await ctx.runQuery(
		internal.admin.support.notifications.getRecentUserMessages,
		{ threadId }
	);

	// After the sync, so the admin list preview and its search index keep the
	// visitor's own message rather than this canned sentence.
	if (options.acknowledge) {
		await saveHandoffAcknowledgement(ctx, supportThread);
	}

	await ctx.scheduler.runAfter(0, internal.admin.support.notifications.scheduleAdminNotification, {
		threadId,
		messageIds: recentMessageIds,
		isReopen: false,
		notificationType: 'newTickets' // Handoff from AI to human
	});

	return true;
}

/** The canned sentence telling the visitor the team has their message. */
function handoffAcknowledgement(supportThread: Doc<'supportThreads'>): string {
	return t(extractLocaleFromUrl(supportThread.pageUrl), 'backend.support.handoff.response');
}

async function saveHandoffAcknowledgement(
	ctx: MutationCtx,
	supportThread: Doc<'supportThreads'>
): Promise<void> {
	await supportAgent.saveMessage(ctx, {
		threadId: supportThread.threadId,
		message: { role: 'assistant', content: handoffAcknowledgement(supportThread) },
		skipEmbeddings: true
	});
}
