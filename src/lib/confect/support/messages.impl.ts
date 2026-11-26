import { FunctionImpl, GroupImpl } from '@confect/server';
import { getFile } from '@convex-dev/agent';
import { APICallError, RetryError, type UserContent } from 'ai';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
	prepareToolErrorRedactionStep,
	toolErrorRedactionTransform
} from '../../chat/core/tool-error-redaction';
import { isSupportAiEnabled } from '../../config/support';
import { components } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import type {
	ActionCtx as ConvexActionCtx,
	MutationCtx as ConvexMutationCtx,
	QueryCtx as ConvexQueryCtx
} from '../../convex/_generated/server';
import { RateLimited } from '../../effect/errors';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import {
	ActionCtx,
	MutationCtx,
	MutationRunner,
	QueryCtx,
	QueryRunner,
	Scheduler
} from '../_generated/services';
import { makeAgentUsageSink } from '../aiUsage/agentUsage';
import { mergeByModel, type CapturedModelUsage } from '../aiUsage/capture';
import { recordAiUsage } from '../aiUsage/record.impl';
import { MAX_MESSAGE_LENGTH } from '../constants';
import {
	CapabilityConfigurationError,
	getCapabilityConfigurations,
	requireAiConfiguration
} from '../env';
import { SupportRefusal } from '../errorCodecs';
import { getFileMetadataByUrls } from '../files/metadata';
import { extractLocaleFromUrl, t } from '../i18n/translations';
import VisitorAccessImpl, { requireOwnedSupportThread } from '../middleware/VisitorAccess.impl';
import { STREAM_DELTA_OPTIONS } from '../streamDeltas';
import { supportAgent } from './agent';
import { SUPPORT_ERROR_CODES } from './errors';
import { settleUnanswered } from './handoff.impl';
import { findSupportThread, turnLogFields, type TurnErrorName } from './handoffTurns';
import { recordSupportMessageContext } from './messageContext';
import { listMessagesForThread } from './messageListing';
import messages from './messages.spec';
import { supportRateLimiter } from './rateLimit';
import type {
	SendMessageArgsSchema,
	TurnOutcomeSchema,
	VisitorMessageListArgsSchema
} from './schemas';
import { recordFirstSupportContact, syncSupportLastMessage } from './threadLifecycle';

type SupportTurn = { threadId: string; promptMessageId: string; userId?: string };
type TurnOutcome = typeof TurnOutcomeSchema.Type;
type CodedTurnError = { errorName: TurnErrorName; status?: number };
type TurnAttempt = { models: CapturedModelUsage[]; error?: CodedTurnError };
type TurnRun = { attempts: TurnAttempt[]; outcome: TurnOutcome; retryRefused: boolean };

const TURN_OUTCOME_PAGE_SIZE = 30;
const MAX_TURN_ATTEMPTS = 2;
const SUPPORT_TURN_CHECK_DELAY = Duration.minutes(3);
const SUPPORT_TURN_EXTRA_CHECKS = 5;
const PRESERVED_TURN_ERROR_NAMES: readonly TurnErrorName[] = ['AbortError', 'TimeoutError'];

const refuse = (refusal: SupportRefusal['refusal']) => Effect.fail(new SupportRefusal({ refusal }));

const requireThreadAccess = (ctx: ConvexQueryCtx, threadId: string) =>
	Effect.gen(function* () {
		const access = yield* requireOwnedSupportThread(ctx.db, threadId);
		yield* Effect.tryPromise({
			try: async () => await supportAgent.getThreadMetadata(ctx, { threadId }),
			catch: () => new SupportRefusal({ refusal: { code: SUPPORT_ERROR_CODES.threadNotFound } })
		});
		return access;
	});

async function readTurnOutcome(
	ctx: ConvexQueryCtx,
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

const hasReplied = (outcome: TurnOutcome) =>
	outcome.answered || (outcome.handedOff && outcome.visibleText);

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

async function runTurnAttempt(
	ctx: ConvexActionCtx,
	turn: SupportTurn,
	instructions: string | undefined
): Promise<TurnAttempt> {
	const sink = makeAgentUsageSink();
	try {
		const result = await supportAgent.streamText(
			ctx,
			{ threadId: turn.threadId, userId: turn.userId },
			{
				promptMessageId: turn.promptMessageId,
				instructions,
				prepareStep: prepareToolErrorRedactionStep,
				experimental_transform: toolErrorRedactionTransform
			},
			{
				usageHandler: sink.usageHandler,
				saveStreamDeltas: STREAM_DELTA_OPTIONS
			}
		);
		await result.consumeStream();
		return { models: sink.collect() };
	} catch (error) {
		return { models: sink.collect(), error: codedTurnError(error) };
	}
}

const readOutcome = (turn: SupportTurn) =>
	Effect.gen(function* () {
		return yield* (yield* QueryRunner)
			.runQuery(refs.internal.support.messages.getTurnOutcome, {
				threadId: turn.threadId,
				promptMessageId: turn.promptMessageId
			})
			.pipe(Effect.orDie);
	});

const runTurn = (ctx: ConvexActionCtx, turn: SupportTurn, instructions: string | undefined) =>
	Effect.gen(function* () {
		const attempts: TurnAttempt[] = [];
		for (;;) {
			const beforeDispatch = yield* readOutcome(turn);
			if (beforeDispatch.handedOff) {
				const run: TurnRun = { attempts, outcome: beforeDispatch, retryRefused: false };
				return run;
			}

			attempts.push(yield* Effect.promise(() => runTurnAttempt(ctx, turn, instructions)));
			const outcome = yield* readOutcome(turn);
			if (outcome.handedOff || outcome.visibleText || attempts.length === MAX_TURN_ATTEMPTS) {
				const run: TurnRun = { attempts, outcome, retryRefused: false };
				return run;
			}

			const retryStatus = yield* Effect.promise(() => supportRateLimiter.limit(ctx, 'globalLLM'));
			if (!retryStatus.ok) {
				const run: TurnRun = { attempts, outcome, retryRefused: true };
				return run;
			}
		}
	});

const recordTurnUsage = (turn: SupportTurn, run: TurnRun) =>
	recordAiUsage({
		feature: 'support_chat',
		userId: turn.userId,
		threadId: turn.threadId,
		status: run.outcome.answered ? 'ok' : run.outcome.visibleText ? 'partial' : 'error',
		models: mergeByModel(run.attempts.flatMap((attempt) => attempt.models))
	});

const unansweredReason = (run: TurnRun) =>
	run.outcome.handedOff
		? 'handoff_without_reply'
		: run.retryRefused
			? 'retry_rate_limited'
			: run.outcome.visibleText
				? 'partial_reply'
				: 'no_reply';

const aiConfigured = Effect.sync(() => {
	try {
		requireAiConfiguration();
		return true;
	} catch (error) {
		if (error instanceof CapabilityConfigurationError) return false;
		throw error;
	}
});

const handToTeam = (threadId: string) =>
	Effect.gen(function* () {
		yield* (yield* MutationRunner)
			.runMutation(refs.internal.support.handoff.internalSetHandoff, {
				threadId,
				acknowledge: true
			})
			.pipe(Effect.orDie);
		return null;
	});

async function saveVisitorMessage(
	ctx: ConvexMutationCtx,
	args: typeof SendMessageArgsSchema.Type
): Promise<string> {
	const messageId = await saveVisitorContent(ctx, args);
	await recordSupportMessageContext(ctx, {
		threadId: args.threadId,
		messageId,
		pageUrl: args.pageUrl,
		appVersion: args.appVersion
	});
	await syncSupportLastMessage(ctx, args.threadId);
	return messageId;
}

async function saveAcknowledgement(ctx: ConvexMutationCtx, supportThread: Doc<'supportThreads'>) {
	await supportAgent.saveMessage(ctx, {
		threadId: supportThread.threadId,
		message: {
			role: 'assistant',
			content: t(extractLocaleFromUrl(supportThread.pageUrl), 'backend.support.handoff.response')
		},
		skipEmbeddings: true
	});
}

async function openThread(
	ctx: ConvexMutationCtx,
	supportThread: Doc<'supportThreads'>,
	isHumanOnly: boolean,
	now: number
) {
	await ctx.db.patch('supportThreads', supportThread._id, {
		isWarm: supportThread.isWarm === true ? false : supportThread.isWarm,
		status: 'open',
		isHandedOff: isHumanOnly ? true : supportThread.isHandedOff,
		awaitingAdminResponse: true,
		updatedAt: now
	});
	await recordFirstSupportContact(ctx, supportThread, now);
}

async function saveAssistantMessage(ctx: ConvexMutationCtx, threadId: string, text: string) {
	const supportThread = await findSupportThread(ctx, threadId);
	if (supportThread?.isHandedOff) return null;
	return await supportAgent.saveMessage(ctx, {
		threadId,
		message: { role: 'assistant', content: text },
		skipEmbeddings: true
	});
}

async function listVisitorMessages(
	ctx: ConvexQueryCtx,
	args: typeof VisitorMessageListArgsSchema.Type
) {
	return await listMessagesForThread(ctx, {
		threadId: args.threadId,
		paginationOpts: args.paginationOpts,
		streamArgs: args.streamArgs,
		hideFailedTextlessAssistant: true
	});
}

async function saveVisitorContent(
	ctx: ConvexMutationCtx,
	args: typeof SendMessageArgsSchema.Type
): Promise<string> {
	if (args.fileIds && args.fileIds.length > 0) {
		const content: UserContent = [];
		if (args.prompt.trim()) {
			content.push({ type: 'text', text: args.prompt });
		}
		for (const fileId of args.fileIds) {
			const { filePart } = await getFile(ctx, components.agent, fileId);
			content.push(filePart);
		}
		const result = await supportAgent.saveMessage(ctx, {
			threadId: args.threadId,
			message: { role: 'user', content },
			metadata: { fileIds: args.fileIds },
			skipEmbeddings: true
		});
		return result.messageId;
	}

	const result = await supportAgent.saveMessage(ctx, {
		threadId: args.threadId,
		prompt: args.prompt,
		skipEmbeddings: true
	});
	return result.messageId;
}

export default GroupImpl.make(databaseSchema, messages).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, messages, 'createAIResponse', (args) =>
			Effect.gen(function* () {
				if (!isSupportAiEnabled() || !(yield* aiConfigured)) {
					return yield* handToTeam(args.threadId);
				}

				if ((yield* readOutcome(args)).handedOff) return null;

				const ctx = yield* ActionCtx;
				const globalStatus = yield* Effect.promise(() =>
					supportRateLimiter.limit(ctx, 'globalLLM')
				);
				if (!globalStatus.ok) {
					yield* Effect.logError(
						`[createAIResponse] Global LLM rate limit exceeded. Retry after: ${globalStatus.retryAfter}ms`
					);
					const locale = yield* (yield* QueryRunner)
						.runQuery(refs.internal.support.threads.getThreadLocale, { threadId: args.threadId })
						.pipe(Effect.orDie);
					yield* (yield* MutationRunner)
						.runMutation(refs.internal.support.messages.createAssistantMessage, {
							threadId: args.threadId,
							text: t(locale, 'backend.support.rate_limit.global')
						})
						.pipe(Effect.orDie);
					return null;
				}

				const systemOverride = yield* (yield* QueryRunner)
					.runQuery(refs.internal.support.promptStore.getActive, {})
					.pipe(Effect.orDie);

				if (!(yield* aiConfigured)) return yield* handToTeam(args.threadId);

				const run = yield* runTurn(ctx, args, systemOverride ?? undefined);
				const [firstAttempt] = run.attempts;
				if (!firstAttempt) return null;

				yield* recordTurnUsage(args, run);

				if (hasReplied(run.outcome)) {
					yield* (yield* MutationRunner)
						.runMutation(refs.internal.support.threads.updateLastMessage, {
							threadId: args.threadId
						})
						.pipe(Effect.orDie);
					if (run.attempts.length > 1) {
						yield* Effect.logWarning({
							code: 'support_turn_retried',
							...turnLogFields({ ...args, attempts: run.attempts.length, ...firstAttempt.error })
						});
					}
					return null;
				}

				const lastError = run.attempts.reduce<CodedTurnError | undefined>(
					(latest, attempt) => attempt.error ?? latest,
					undefined
				);
				yield* (yield* MutationRunner)
					.runMutation(refs.internal.support.handoff.settleUnansweredTurn, {
						threadId: args.threadId,
						promptMessageId: args.promptMessageId,
						reason: unansweredReason(run),
						attempts: run.attempts.length,
						visibleText: run.outcome.visibleText,
						...lastError
					})
					.pipe(Effect.orDie);
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'createAssistantMessage', ({ threadId, text }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => saveAssistantMessage(ctx, threadId, text));
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'ensureSupportTurnSettled', (args) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const job = yield* Effect.promise(() =>
					ctx.db.system.get('_scheduled_functions', args.jobId)
				);
				const state = job?.state.kind;

				if (state === 'success') return null;

				if ((state === 'pending' || state === 'inProgress') && args.checksLeft > 0) {
					yield* (yield* Scheduler).runAfter(
						SUPPORT_TURN_CHECK_DELAY,
						refs.internal.support.messages.ensureSupportTurnSettled,
						{ ...args, checksLeft: args.checksLeft - 1 }
					);
					return null;
				}

				const outcome = yield* Effect.promise(() => readTurnOutcome(ctx, args));
				if (hasReplied(outcome)) return null;

				if (state === 'pending' || state === 'inProgress' || state === 'canceled') {
					yield* Effect.logError({
						code: 'support_turn_unsettled',
						...turnLogFields({ threadId: args.threadId, promptMessageId: args.promptMessageId }),
						state
					});
					return null;
				}

				yield* settleUnanswered({
					threadId: args.threadId,
					promptMessageId: args.promptMessageId,
					reason: job ? 'job_failed' : 'job_missing',
					visibleText: outcome.visibleText
				});
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'getFileMetadataBatch', ({ urls }) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => getFileMetadataByUrls(ctx, urls));
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'getTurnOutcome', (turn) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => readTurnOutcome(ctx, turn));
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'listMessages', (args) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				yield* requireThreadAccess(ctx, args.threadId);
				return yield* Effect.promise(() => listVisitorMessages(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'sendMessage', (args) =>
			Effect.gen(function* () {
				if (args.prompt.length > MAX_MESSAGE_LENGTH) {
					return yield* refuse({
						code: SUPPORT_ERROR_CODES.messageTooLong,
						maxLength: MAX_MESSAGE_LENGTH
					});
				}

				const ctx = yield* MutationCtx;
				const { owner, supportThread } = yield* requireThreadAccess(ctx, args.threadId);
				const effectiveUserId = owner.ownerId;
				const wasWarmThread = supportThread.isWarm === true;
				const wasHandedOff = supportThread.isHandedOff === true;
				const aiEnabled =
					isSupportAiEnabled() && getCapabilityConfigurations().ai.state === 'ready';
				const isHumanOnly = wasHandedOff || !aiEnabled;

				const limitName = owner.isAnonymous ? 'supportMessageAnon' : 'supportMessage';
				const userKey = effectiveUserId || `anon:${args.threadId}`;
				const rateLimitStatus = yield* Effect.promise(() =>
					supportRateLimiter.limit(ctx, limitName, { key: userKey })
				);
				if (!rateLimitStatus.ok) {
					return yield* Effect.fail(new RateLimited({ retryAfter: rateLimitStatus.retryAfter }));
				}

				const messageId = yield* Effect.promise(() => saveVisitorMessage(ctx, args));

				const announced =
					isHumanOnly && !wasHandedOff && !wasWarmThread
						? yield* (yield* QueryRunner)
								.runQuery(refs.internal.admin.support.notifications.getRecentUserMessages, {
									threadId: args.threadId
								})
								.pipe(Effect.orDie)
						: [];

				if (isHumanOnly && !wasHandedOff) {
					yield* Effect.promise(() => saveAcknowledgement(ctx, supportThread));
				}

				const scheduler = yield* Scheduler;
				if (!isHumanOnly) {
					const jobId = yield* scheduler.runAfter(
						Duration.zero,
						refs.internal.support.messages.createAIResponse,
						{ threadId: args.threadId, promptMessageId: messageId, userId: effectiveUserId }
					);
					yield* scheduler.runAfter(
						SUPPORT_TURN_CHECK_DELAY,
						refs.internal.support.messages.ensureSupportTurnSettled,
						{
							threadId: args.threadId,
							promptMessageId: messageId,
							jobId,
							checksLeft: SUPPORT_TURN_EXTRA_CHECKS
						}
					);
				}

				const wasClosedBeforeThisMessage = supportThread.status === 'done';
				yield* Effect.promise(() => openThread(ctx, supportThread, isHumanOnly, Date.now()));

				if (isHumanOnly) {
					yield* scheduler.runAfter(
						Duration.zero,
						refs.internal.admin.support.notifications.scheduleAdminNotification,
						{
							threadId: args.threadId,
							messageIds: announced.length > 0 ? announced : [messageId],
							isReopen: wasClosedBeforeThisMessage,
							notificationType:
								wasClosedBeforeThisMessage || !wasHandedOff ? 'newTickets' : 'userReplies'
						}
					);
				}

				return { messageId };
			})
		)
	]),
	Layer.provide(VisitorAccessImpl),
	GroupImpl.finalize
);
