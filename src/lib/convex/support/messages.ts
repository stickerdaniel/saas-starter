import type { MessagesQueryResponse } from '../../chat/core/types';
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
	type ActionCtx,
	type QueryCtx
} from '../_generated/server';
import { v, type Infer } from 'convex/values';
import { internal } from '../_generated/api';
import { supportAgent } from './agent';
import { paginationOptsValidator } from 'convex/server';
import { getFile } from '@convex-dev/agent';
import { vStreamArgs } from '@convex-dev/agent/validators';
import { components } from '../_generated/api';
import { APICallError, RetryError, type UserContent } from 'ai';
import { supportRateLimiter } from './rateLimit';
import { isSupportAiEnabled } from '../../config/support';
import { createRateLimitError } from './types';
import { SUPPORT_ERROR_CODES, createSupportError } from './errors';
import { t, extractLocaleFromUrl } from '../i18n/translations';
import { MAX_MESSAGE_LENGTH } from '../constants';
import { normalizeSupportPageRoute } from '../../shared/support-page-route';
import { requireSupportThreadAccess } from './ownership';
import { listMessagesForThread } from './messageListing';
import { syncSupportLastMessage } from './threads';
import { recordFirstSupportContact } from './threadLifecycle';
import { getFileMetadataByUrls } from '../files/metadata';
import { makeAgentUsageSink } from '../aiUsage/agentUsage';
import { recordAiUsage } from '../aiUsage/record';
import { mergeByModel, type CapturedModelUsage } from '../aiUsage/capture';
import {
	settleUnanswered,
	turnLogFields,
	type TurnErrorName,
	type UnansweredTurn
} from './handoff';
import {
	CapabilityConfigurationError,
	getCapabilityConfigurations,
	requireAiConfiguration
} from '../env';
import {
	prepareToolErrorRedactionStep,
	toolErrorRedactionTransform
} from '../../chat/core/tool-error-redaction';

type SupportTurn = { threadId: string; promptMessageId: string; userId?: string };

const turnOutcomeValidator = v.object({
	handedOff: v.boolean(),
	/** The agent saved a successful assistant row with text for this prompt. */
	answered: v.boolean(),
	/** Some assistant row for this prompt, of any status, has text the visitor may have seen. */
	visibleText: v.boolean()
});

type TurnOutcome = Infer<typeof turnOutcomeValidator>;

/**
 * Rows read back for one turn. Each attempt runs at most five model steps
 * (agent.ts), each an assistant row plus a tool row, so two attempts and their
 * prompt fit with room to spare.
 */
const TURN_OUTCOME_PAGE_SIZE = 30;

/**
 * What a support agent turn left in the thread, read from the persisted rows
 * rather than from the stream: the AI SDK hands a provider error mid-stream to
 * its error callback and `consumeStream()` returns normally, so a turn that
 * saved nothing but a failed reasoning row looks exactly like one that answered.
 *
 * Reads only the prompt's own order. `upToAndIncludingMessageId` keeps later
 * messages from another tab out of the bounded page, where they could push the
 * turn's own rows out of it.
 */
async function readTurnOutcome(
	ctx: QueryCtx,
	turn: { threadId: string; promptMessageId: string }
): Promise<TurnOutcome> {
	const supportThread = await ctx.db
		.query('supportThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', turn.threadId))
		.first();
	const handedOff = supportThread?.isHandedOff === true;

	const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
		messageIds: [turn.promptMessageId]
	});
	if (!prompt) return { handedOff, answered: false, visibleText: false };

	const latest = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
		threadId: turn.threadId,
		order: 'desc',
		upToAndIncludingMessageId: turn.promptMessageId,
		paginationOpts: { numItems: TURN_OUTCOME_PAGE_SIZE, cursor: null }
	});
	const replies = latest.page.filter(
		(row) => row.order === prompt.order && row.message?.role === 'assistant' && row.text?.trim()
	);
	return {
		handedOff,
		answered: replies.some((row) => row.status === 'success'),
		visibleText: replies.length > 0
	};
}

/** The turn needs nothing more: the agent answered, or handed off and said so. */
function hasReplied(outcome: TurnOutcome): boolean {
	return outcome.answered || (outcome.handedOff && outcome.visibleText);
}

type CodedTurnError = { errorName: TurnErrorName; status?: number };

const PRESERVED_TURN_ERROR_NAMES: readonly TurnErrorName[] = ['AbortError', 'TimeoutError'];

/**
 * Reduce whatever a turn attempt threw to an allowlisted name and an integer
 * HTTP status, the only parts of it a log line may carry. The AI SDK wraps
 * exhausted provider retries in a RetryError, so its last error is the one read.
 */
function codedTurnError(thrown: unknown): CodedTurnError {
	const error = RetryError.isInstance(thrown) ? thrown.lastError : thrown;
	if (APICallError.isInstance(error)) {
		return Number.isInteger(error.statusCode)
			? { errorName: 'APICallError', status: error.statusCode }
			: { errorName: 'APICallError' };
	}
	const preserved =
		error instanceof Error
			? PRESERVED_TURN_ERROR_NAMES.find((name) => name === error.name)
			: undefined;
	return { errorName: preserved ?? 'other' };
}

type TurnAttempt = { models: CapturedModelUsage[]; error?: CodedTurnError };

/**
 * Run the support agent once on the turn's prompt. Every attempt reuses the
 * same promptMessageId: the agent then saves no second copy of the visitor's
 * message, marks the earlier attempt's pending steps failed, and leaves failed
 * rows out of the model's context. A throw is caught and returned, because the
 * persisted outcome, not the way the attempt ended, decides what happens next.
 *
 * The usage sink is local to the attempt so a retry does not count the first
 * attempt's tokens again.
 */
async function runTurnAttempt(
	ctx: ActionCtx,
	turn: SupportTurn,
	instructions: string | undefined
): Promise<TurnAttempt> {
	const sink = makeAgentUsageSink();
	try {
		// Stream the AI response with tool execution support
		// maxSteps is configured at the agent level (agent.ts) for multi-step tool execution
		const result = await supportAgent.streamText(
			ctx,
			{ threadId: turn.threadId, userId: turn.userId },
			{
				promptMessageId: turn.promptMessageId,
				// AgentPrompt.instructions overrides the agent's instructions for this turn;
				// undefined leaves SUPPORT_AGENT_INSTRUCTIONS in place.
				instructions,
				prepareStep: prepareToolErrorRedactionStep,
				experimental_transform: toolErrorRedactionTransform
			},
			{
				usageHandler: sink.usageHandler,
				// Save streaming deltas to database for real-time updates
				saveStreamDeltas: {
					chunking: 'line',
					throttleMs: 100
				}
			}
		);

		// Consume the stream to process all tool calls and responses
		await result.consumeStream();
		return { models: sink.collect() };
	} catch (error) {
		return { models: sink.collect(), error: codedTurnError(error) };
	}
}

async function readOutcome(ctx: ActionCtx, turn: SupportTurn): Promise<TurnOutcome> {
	return await ctx.runQuery(internal.support.messages.getTurnOutcome, {
		threadId: turn.threadId,
		promptMessageId: turn.promptMessageId
	});
}

/** A turn gets one retry, and only when its attempt left nothing at all. */
const MAX_TURN_ATTEMPTS = 2;

type TurnRun = { attempts: TurnAttempt[]; outcome: TurnOutcome; retryRefused: boolean };

/**
 * Run the support agent on the turn until it leaves something, at most twice,
 * and return what the thread shows afterwards.
 *
 * The thread is read again right before every model dispatch: the team can take
 * it over at any point, and once they hold it the agent starts no further run
 * on it. A run skipped this way is not in `attempts`.
 */
async function runTurn(
	ctx: ActionCtx,
	turn: SupportTurn,
	instructions: string | undefined
): Promise<TurnRun> {
	const attempts: TurnAttempt[] = [];
	for (;;) {
		const beforeDispatch = await readOutcome(ctx, turn);
		if (beforeDispatch.handedOff) {
			return { attempts, outcome: beforeDispatch, retryRefused: false };
		}

		attempts.push(await runTurnAttempt(ctx, turn, instructions));
		const outcome = await readOutcome(ctx, turn);

		// Anything the visitor can see ends the turn: a retry would repeat it, and a
		// thread the agent handed off belongs to the team. So does the last attempt.
		if (outcome.handedOff || outcome.visibleText || attempts.length === MAX_TURN_ATTEMPTS) {
			return { attempts, outcome, retryRefused: false };
		}

		// The attempt left nothing the visitor can see, so the agent gets one more.
		// The restart is safe because the only support tool with a side effect,
		// request_handoff, is idempotent: a repeated call finds the thread already
		// handed off. Adding a tool that is not idempotent means revisiting this
		// retry. It is a second full model run, so it pays the global budget again.
		const retryStatus = await supportRateLimiter.limit(ctx, 'globalLLM');
		if (!retryStatus.ok) return { attempts, outcome, retryRefused: true };
	}
}

/**
 * Record the turn's usage as one `support_chat` row, however many attempts it
 * took. The status follows what the turn left: `ok` only when it answered,
 * `partial` when it left text short of an answer, `error` otherwise.
 */
async function recordTurnUsage(ctx: ActionCtx, turn: SupportTurn, run: TurnRun): Promise<void> {
	// turn.userId may be an anon_* id for anonymous support; store as-is
	await recordAiUsage(ctx, {
		feature: 'support_chat',
		userId: turn.userId,
		threadId: turn.threadId,
		status: run.outcome.answered ? 'ok' : run.outcome.visibleText ? 'partial' : 'error',
		models: mergeByModel(run.attempts.flatMap((attempt) => attempt.models))
	});
}

/** Hand an unanswered turn to the team, with the reason it ended that way. */
async function settleUnansweredTurn(
	ctx: ActionCtx,
	turn: SupportTurn,
	details: Omit<UnansweredTurn, 'threadId' | 'promptMessageId'>
): Promise<void> {
	await ctx.runMutation(internal.support.handoff.settleUnansweredTurn, {
		threadId: turn.threadId,
		promptMessageId: turn.promptMessageId,
		...details
	});
}

/** Wait between two looks the watchdog takes at a support agent turn. */
const SUPPORT_TURN_CHECK_DELAY_MS = 3 * 60 * 1000;
/** Looks the watchdog takes after its first before it stops waiting and logs. */
const SUPPORT_TURN_EXTRA_CHECKS = 5;

/**
 * Send a user message and get AI response with streaming
 *
 * This mutation saves the user's message and schedules an internal action
 * to generate the AI response asynchronously with streaming support.
 *
 * Supports multimodal messages with file and image attachments.
 */
export const sendMessage = mutation({
	args: {
		threadId: v.string(),
		prompt: v.string(),
		anonymousUserId: v.optional(v.string()),
		fileIds: v.optional(v.array(v.string())),
		// Optional so clients that predate per-message routes stay valid.
		pageUrl: v.optional(v.string())
	},
	returns: v.object({ messageId: v.string() }),
	handler: async (ctx, args) => {
		if (args.prompt.length > MAX_MESSAGE_LENGTH) {
			throw createSupportError(SUPPORT_ERROR_CODES.messageTooLong, {
				maxLength: MAX_MESSAGE_LENGTH
			});
		}

		const { owner, supportThread } = await requireSupportThreadAccess(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});
		const effectiveUserId = owner.ownerId;
		const wasWarmThread = supportThread.isWarm === true;

		// A thread created while the agent was still enabled keeps isHandedOff
		// false, so the mode has to be re-read per message: otherwise disabling
		// the agent would leave those threads waiting for a reply nobody sends.
		const wasHandedOff = supportThread.isHandedOff === true;
		const aiEnabled = isSupportAiEnabled() && getCapabilityConfigurations().ai.state === 'ready';
		const isHumanOnly = wasHandedOff || !aiEnabled;

		// Rate limit check - stricter limits for anonymous users
		// Authenticated users: keyed by verified user ID
		// Anonymous users: keyed by anonymous user ID (fallback: thread ID if none)
		const limitName = owner.isAnonymous ? 'supportMessageAnon' : 'supportMessage';
		const userKey = effectiveUserId || `anon:${args.threadId}`;

		const rateLimitStatus = await supportRateLimiter.limit(ctx, limitName, { key: userKey });

		if (!rateLimitStatus.ok) {
			throw createRateLimitError(rateLimitStatus.retryAfter);
		}

		let messageId: string;

		// Check if we have file attachments
		if (args.fileIds && args.fileIds.length > 0) {
			// Build multimodal message content
			const content: UserContent = [];

			// Add text part
			if (args.prompt.trim()) {
				content.push({
					type: 'text',
					text: args.prompt
				});
			}

			// Add file/image parts
			// Note: Dimensions are now stored separately in fileMetadata table at upload time
			// and retrieved via getFileMetadataBatch query on the frontend
			for (const fileId of args.fileIds) {
				const { filePart } = await getFile(ctx, components.agent, fileId);

				// Use filePart for all files - preserves filename for both images and PDFs
				// The mediaType field (e.g. "image/jpeg", "application/pdf") allows LLMs to identify content type
				content.push(filePart);
			}

			// Save multimodal message
			const result = await supportAgent.saveMessage(ctx, {
				threadId: args.threadId,
				message: {
					role: 'user',
					content
				},
				metadata: { fileIds: args.fileIds },
				skipEmbeddings: true
			});

			messageId = result.messageId;
		} else {
			// Save text-only message
			const result = await supportAgent.saveMessage(ctx, {
				threadId: args.threadId,
				prompt: args.prompt,
				skipEmbeddings: true
			});

			messageId = result.messageId;
		}

		const pageUrl = normalizeSupportPageRoute(args.pageUrl);

		// Where this message was written from. The thread keeps the pageUrl
		// captured before its first message, so it cannot describe a later report
		// sent after the visitor navigates elsewhere. The route is deliberately
		// optional: invalid metadata cannot discard the message that was already
		// saved.
		if (pageUrl) {
			await ctx.db.insert('supportMessageContexts', {
				threadId: args.threadId,
				messageId,
				pageUrl,
				createdAt: Date.now()
			});
		}

		// Sync denormalized search fields with user's message
		await syncSupportLastMessage(ctx, args.threadId);

		// A thread the agent used to answer reaches the team for the first time
		// here, with its actual report somewhere above this message. Announcing
		// only the newest one would hand them "still broken" and nothing to read
		// it against, so the first announcement carries the conversation the way
		// the handoff button's does. On a thread they already hold, this message
		// is the reply and the rest is already on their ticket; a warm thread was
		// created empty, so this message is all there is.
		//
		// Read before the acknowledgement is written. That query keeps the newest
		// 50 entries of any role and filters afterwards, so the canned sentence
		// would take a slot and, on a long thread, push the report it exists to
		// deliver out of the window.
		const announced =
			isHumanOnly && !wasHandedOff && !wasWarmThread
				? await ctx.runQuery(internal.admin.support.notifications.getRecentUserMessages, {
						threadId: args.threadId
					})
				: [];

		// A thread arriving in the human inbox for the first time gets the same
		// acknowledgement the handoff button writes. Without it an anonymous
		// visitor sees no reply at all, and the widget's email prompt has
		// nothing to render against: it hangs off exactly this message.
		//
		// Written after the sync on purpose. The denormalized fields feed the
		// admin list preview and its search index, and this text is identical on
		// every new ticket, so syncing it would leave the inbox a column of the
		// same canned sentence with the report itself unsearchable.
		if (isHumanOnly && !wasHandedOff) {
			await supportAgent.saveMessage(ctx, {
				threadId: args.threadId,
				message: {
					role: 'assistant',
					content: t(
						extractLocaleFromUrl(supportThread.pageUrl),
						'backend.support.handoff.response'
					)
				},
				skipEmbeddings: true
			});
		}

		// Only humans respond once a thread is human-only
		if (!isHumanOnly) {
			// AI mode: Schedule async action to generate AI response with streaming
			const jobId = await ctx.scheduler.runAfter(0, internal.support.messages.createAIResponse, {
				threadId: args.threadId,
				promptMessageId: messageId,
				userId: effectiveUserId
			});
			// Scheduled actions run at most once and can die without settling the
			// turn themselves; the watchdog hands such a turn to the team.
			await ctx.scheduler.runAfter(
				SUPPORT_TURN_CHECK_DELAY_MS,
				internal.support.messages.ensureSupportTurnSettled,
				{
					threadId: args.threadId,
					promptMessageId: messageId,
					jobId,
					checksLeft: SUPPORT_TURN_EXTRA_CHECKS
				}
			);
		}

		// Reopen thread and mark as awaiting response when user sends message
		// Check if this is a reopened ticket (was closed, now being reopened)
		const wasClosedBeforeThisMessage = supportThread.status === 'done';
		const now = Date.now();

		await ctx.db.patch('supportThreads', supportThread._id, {
			isWarm: wasWarmThread ? false : supportThread.isWarm,
			status: 'open',
			// Latch the mode onto the record so the widget stops offering the AI
			// affordances and the admin list shows the thread as human-only.
			isHandedOff: isHumanOnly ? true : supportThread.isHandedOff,
			awaitingAdminResponse: true,
			updatedAt: now
		});
		await recordFirstSupportContact(ctx, supportThread, now);

		// Schedule admin notification for human-only tickets
		// We only notify for those since AI-handled tickets don't need admin attention
		// Note: scheduleAdminNotification handles both create and update cases internally
		if (isHumanOnly) {
			await ctx.scheduler.runAfter(
				0,
				internal.admin.support.notifications.scheduleAdminNotification,
				{
					threadId: args.threadId,
					messageIds: announced.length > 0 ? announced : [messageId],
					isReopen: wasClosedBeforeThisMessage,
					// The flag is the record of what the team has been told: it is only
					// ever set once a thread has been announced to them, so a message
					// arriving before that opens a ticket and one arriving after is a
					// reply on a ticket they hold. Reopening announces it again.
					notificationType:
						wasClosedBeforeThisMessage || !wasHandedOff ? 'newTickets' : 'userReplies'
				}
			);
		}

		return { messageId };
	}
});

/**
 * Internal action to generate AI response with streaming
 *
 * This runs asynchronously and streams the AI response back to the database,
 * which automatically syncs to all connected clients via Convex's reactivity.
 *
 * Every turn ends answered or with the team: after each attempt the persisted
 * outcome is read back, an attempt that left nothing visible is retried once,
 * and a turn still without a reply is handed off through settleUnansweredTurn,
 * which acknowledges the visitor and logs it. ensureSupportTurnSettled covers a
 * job that dies before it gets that far.
 */
export const createAIResponse = internalAction({
	args: {
		threadId: v.string(),
		promptMessageId: v.string(),
		userId: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// sendMessage decides the mode, but the agent can be switched off or lose
		// provider configuration while a scheduled job is still queued. Dropping
		// that job would strand the message, so hand it to the team instead.
		let aiReady = isSupportAiEnabled();
		if (aiReady) {
			try {
				requireAiConfiguration();
			} catch (error) {
				if (!(error instanceof CapabilityConfigurationError)) throw error;
				aiReady = false;
			}
		}
		if (!aiReady) {
			await ctx.runMutation(internal.support.handoff.internalSetHandoff, {
				threadId: args.threadId,
				// No model is going to speak in this turn, so the acknowledgement has
				// to come from the handoff itself: it is the visitor's only reply, and
				// the widget's email prompt renders against exactly that message.
				acknowledge: true
			});
			return null;
		}

		// The team can take the thread over while this job is queued. It is theirs
		// then: no model call, and no rate-limit copy from the agent either.
		// runTurn reads it again right before each model dispatch.
		if ((await readOutcome(ctx, args)).handedOff) return null;

		// Global rate limit check for cost protection
		// This MUST fail the request to protect against runaway costs
		const globalStatus = await supportRateLimiter.limit(ctx, 'globalLLM');
		if (!globalStatus.ok) {
			console.error(
				`[createAIResponse] Global LLM rate limit exceeded. Retry after: ${globalStatus.retryAfter}ms`
			);

			// Get locale from thread's pageUrl for translated message
			const locale = await ctx.runQuery(internal.support.threads.getThreadLocale, {
				threadId: args.threadId
			});

			// Save a system message so user knows why there's no response
			await ctx.runMutation(internal.support.messages.createAssistantMessage, {
				threadId: args.threadId,
				text: t(locale, 'backend.support.rate_limit.global')
			});

			// Don't throw - message saved explains the situation
			return null;
		}

		// Load the active support prompt override, if any. null falls back to the
		// agent's built-in SUPPORT_AGENT_INSTRUCTIONS (agent.ts). The seam already
		// accepts a locale; we pass none here and serve the global default.
		const systemOverride = await ctx.runQuery(internal.support.promptStore.getActive, {});

		try {
			requireAiConfiguration();
		} catch (error) {
			if (!(error instanceof CapabilityConfigurationError)) throw error;
			await ctx.runMutation(internal.support.handoff.internalSetHandoff, {
				threadId: args.threadId,
				acknowledge: true
			});
			return null;
		}

		const run = await runTurn(ctx, args, systemOverride ?? undefined);
		const [firstAttempt] = run.attempts;
		// The team took the thread before the agent dispatched anything: it is theirs.
		if (!firstAttempt) return null;

		await recordTurnUsage(ctx, args, run);

		if (hasReplied(run.outcome)) {
			// Sync denormalized search fields with AI response
			await ctx.runMutation(internal.support.threads.updateLastMessage, {
				threadId: args.threadId
			});
			if (run.attempts.length > 1) {
				console.warn({
					code: 'support_turn_retried',
					...turnLogFields({ ...args, attempts: run.attempts.length, ...firstAttempt.error })
				});
			}
			return null;
		}

		// A thread already handed off with nothing said to the visitor (the agent's
		// request_handoff, or the team taking it before the retry) is settled with
		// the acknowledgement alone; the team already knows.
		const { outcome } = run;
		const lastError = run.attempts.reduce<CodedTurnError | undefined>(
			(latest, attempt) => attempt.error ?? latest,
			undefined
		);
		await settleUnansweredTurn(ctx, args, {
			reason: outcome.handedOff
				? 'handoff_without_reply'
				: run.retryRefused
					? 'retry_rate_limited'
					: outcome.visibleText
						? 'partial_reply'
						: 'no_reply',
			attempts: run.attempts.length,
			visibleText: outcome.visibleText,
			...lastError
		});
		return null;
	}
});

/** The persisted outcome of one support agent turn, for createAIResponse between its steps. */
export const getTurnOutcome = internalQuery({
	args: {
		threadId: v.string(),
		promptMessageId: v.string()
	},
	returns: turnOutcomeValidator,
	handler: async (ctx, args) => await readTurnOutcome(ctx, args)
});

/**
 * Watchdog for a support agent turn whose job may never settle it.
 *
 * createAIResponse settles every turn it gets to the end of. This covers the
 * job that does not: it failed, or its scheduler row is gone. Then a turn the
 * thread shows unsettled goes through the same settlement the action uses. A job
 * still pending or running may yet write a reply, so the watchdog waits for it
 * instead, and after its last look logs an error about a turn still unsettled
 * rather than handing it off underneath the job. A canceled job is logged the
 * same way: nothing here cancels one, and canceling does not stop an action that
 * already started.
 */
export const ensureSupportTurnSettled = internalMutation({
	args: {
		threadId: v.string(),
		promptMessageId: v.string(),
		jobId: v.id('_scheduled_functions'),
		checksLeft: v.number()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const job = await ctx.db.system.get('_scheduled_functions', args.jobId);
		const state = job?.state.kind;

		if (state === 'success') return null;

		if ((state === 'pending' || state === 'inProgress') && args.checksLeft > 0) {
			await ctx.scheduler.runAfter(
				SUPPORT_TURN_CHECK_DELAY_MS,
				internal.support.messages.ensureSupportTurnSettled,
				{ ...args, checksLeft: args.checksLeft - 1 }
			);
			return null;
		}

		const outcome = await readTurnOutcome(ctx, args);
		if (hasReplied(outcome)) return null;

		if (state === 'pending' || state === 'inProgress' || state === 'canceled') {
			console.error({
				code: 'support_turn_unsettled',
				...turnLogFields({ threadId: args.threadId, promptMessageId: args.promptMessageId }),
				state
			});
			return null;
		}

		await settleUnanswered(ctx, {
			threadId: args.threadId,
			promptMessageId: args.promptMessageId,
			reason: job ? 'job_failed' : 'job_missing',
			visibleText: outcome.visibleText
		});
		return null;
	}
});

/**
 * List messages in a thread with streaming support
 *
 * Returns paginated messages with streaming deltas included.
 * This query is reactive and will automatically update when new messages or
 * streaming deltas arrive.
 *
 * Note: We fetch messages using listMessagesByThreadId and enrich with UIMessage
 * format because listUIMessages doesn't include custom metadata fields.
 */
export const listMessages = query({
	args: {
		threadId: v.string(),
		anonymousUserId: v.optional(v.string()),
		paginationOpts: paginationOptsValidator,
		streamArgs: vStreamArgs
	},
	// v.any(): paginated message + stream shape is owned by @convex-dev/agent
	returns: v.any(),
	handler: async (ctx, args): Promise<MessagesQueryResponse> => {
		await requireSupportThreadAccess(ctx, {
			threadId: args.threadId,
			anonymousUserId: args.anonymousUserId
		});
		return await listMessagesForThread(ctx, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts,
			streamArgs: args.streamArgs,
			hideFailedTextlessAssistant: true
		});
	}
});

/**
 * Save an assistant message in the support agent's name, such as the global
 * rate-limit notice.
 *
 * Writes nothing once the thread is handed off: the team owns it from then on,
 * and the check sits in this transaction because the action that asks for the
 * message may have read the thread before the visitor handed it over.
 */
export const createAssistantMessage = internalMutation({
	args: {
		threadId: v.string(),
		text: v.string()
	},
	// v.any(): saveMessage result shape (messageId + message doc) is owned by @convex-dev/agent
	returns: v.any(),
	handler: async (ctx, args) => {
		const supportThread = await ctx.db
			.query('supportThreads')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.first();
		if (supportThread?.isHandedOff) return null;

		return await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: {
				role: 'assistant',
				content: args.text
			},
			skipEmbeddings: true
		});
	}
});

/**
 * Get file metadata (dimensions) for multiple files by URL
 *
 * Used to load image dimensions for proper dialog sizing when
 * displaying message attachments. Queries directly by URL since
 * we store the URL from the agent component.
 *
 * Returns a map of URL -> dimensions.
 */
export const getFileMetadataBatch = query({
	args: {
		urls: v.array(v.string())
	},
	returns: v.record(
		v.string(),
		v.object({ width: v.optional(v.number()), height: v.optional(v.number()) })
	),
	handler: async (ctx, args): Promise<Record<string, { width?: number; height?: number }>> => {
		return await getFileMetadataByUrls(ctx, args.urls);
	}
});
