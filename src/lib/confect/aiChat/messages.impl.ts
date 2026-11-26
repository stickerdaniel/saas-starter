import { FunctionImpl, GroupImpl } from '@confect/server';
import { abortStream, getFile, saveMessages } from '@convex-dev/agent';
import type { UserContent } from 'ai';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
	prepareToolErrorRedactionStep,
	toolErrorRedactionTransform
} from '../../chat/core/tool-error-redaction';
import { components, internal } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import type {
	ActionCtx as ConvexActionCtx,
	MutationCtx as ConvexMutationCtx
} from '../../convex/_generated/server';
import { RateLimited } from '../../effect/errors';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { ActionCtx, MutationCtx, QueryCtx, Scheduler } from '../_generated/services';
import { ensureCaptureStart } from '../admin/journey/capture';
import { makeAgentUsageSink } from '../aiUsage/agentUsage';
import { recordAiUsage } from '../aiUsage/record.impl';
import { checkAndCountUsage, refundUsage } from '../autumn';
import {
	AI_CHAT_GENERATION_FAILED_NOTICE,
	AI_CHAT_LIMIT_NOTICE,
	MAX_MESSAGE_FILES,
	MAX_MESSAGE_LENGTH,
	type AiChatNotice
} from '../constants';
import {
	CapabilityConfigurationError,
	requireAiConfiguration,
	requireBillingConfiguration
} from '../env';
import { AiChatRefusal } from '../errorCodecs';
import { getFileMetadataByUrls } from '../files/metadata';
import RequireUserImpl from '../middleware/RequireUser.impl';
import { CurrentUser } from '../middleware/RequireUser.spec';
import { STREAM_DELTA_OPTIONS } from '../streamDeltas';
import { listMessagesForThread } from '../support/messageListing';
import { aiChatAgent } from './agent';
import { AI_CHAT_ERROR_CODES } from './errors';
import messages from './messages.spec';
import { ownedAiChatThread } from './ownership';
import { aiChatRateLimiter } from './rateLimit';
import type { AIResponseArgsSchema, SendMessageArgsSchema } from './schemas';
import { getAiChatSidebarActivityAt } from './visibility';

const THREAD_PREVIEW_LENGTH = 100;
const UNAVAILABLE_REPLY = "This reply couldn't be generated because AI is unavailable.";

type ReplyArgs = typeof AIResponseArgsSchema.Type;
type ThreadRecord = Doc<'aiChatThreads'>;
type TurnStart =
	{ readonly kind: 'settled' } | { readonly kind: 'generate'; readonly usageCounted: boolean };
type StreamedReply = {
	readonly failure: { readonly error: unknown } | undefined;
	readonly text: string;
	readonly models: ReturnType<ReturnType<typeof makeAgentUsageSink>['collect']>;
};

const limitMessage = (ctx: ConvexMutationCtx, userId: string) =>
	Effect.gen(function* () {
		const status = yield* Effect.promise(() =>
			aiChatRateLimiter.limit(ctx, 'aiChatMessage', { key: userId })
		);
		if (!status.ok) return yield* Effect.fail(new RateLimited({ retryAfter: status.retryAfter }));
	});

async function saveUserMessage(
	ctx: ConvexMutationCtx,
	args: typeof SendMessageArgsSchema.Type,
	userId: string,
	record: ThreadRecord
) {
	const saved =
		args.fileIds && args.fileIds.length > 0
			? await aiChatAgent.saveMessage(ctx, {
					threadId: args.threadId,
					message: { role: 'user', content: await fileContent(ctx, args.prompt, args.fileIds) },
					metadata: { fileIds: args.fileIds },
					skipEmbeddings: true
				})
			: await aiChatAgent.saveMessage(ctx, {
					threadId: args.threadId,
					prompt: args.prompt,
					skipEmbeddings: true
				});

	await ctx.db.insert('aiChatMessageReceipts', { userId });
	await ensureCaptureStart(ctx, 'aiChat');

	const preview = args.prompt.trim().slice(0, THREAD_PREVIEW_LENGTH);
	const lastMessageAt = Date.now();
	await ctx.db.patch('aiChatThreads', record._id, {
		...(preview ? { lastMessage: preview } : {}),
		lastMessageAt,
		sidebarActivityAt: getAiChatSidebarActivityAt({ ...record, isWarm: false, lastMessageAt })
	});
	return saved;
}

async function fileContent(ctx: ConvexMutationCtx, prompt: string, fileIds: string[]) {
	const content: UserContent = [];
	if (prompt.trim()) content.push({ type: 'text', text: prompt });
	for (const fileId of fileIds) {
		const { filePart } = await getFile(ctx, components.agent, fileId);
		content.push(filePart);
	}
	return content;
}

async function saveTerminalNotice(
	ctx: ConvexActionCtx,
	args: ReplyArgs,
	{ content, notice }: { content: string; notice?: AiChatNotice }
) {
	const { messages: saved } = await saveMessages(ctx, components.agent, {
		threadId: args.threadId,
		userId: args.userId,
		promptMessageId: args.promptMessageId,
		failPendingSteps: true,
		messages: [{ role: 'assistant', content }],
		...(notice
			? { metadata: [{ provider: 'system', providerMetadata: { system: { notice } } }] }
			: {})
	});
	const [first] = saved;
	if (first) {
		await abortStream(ctx, components.agent, {
			threadId: args.threadId,
			order: first.order,
			reason: 'AI chat reply failed'
		});
	}
}

function aiReady(check: () => void) {
	try {
		check();
		return true;
	} catch (error) {
		if (!(error instanceof CapabilityConfigurationError)) throw error;
		return false;
	}
}

async function refundCounted(args: ReplyArgs, usageCounted: boolean) {
	if (args.userId && usageCounted) {
		await refundUsage({ customerId: args.userId, featureId: 'ai_chat_messages' });
	}
}

async function startTurn(ctx: ConvexActionCtx, args: ReplyArgs): Promise<TurnStart> {
	const ready = aiReady(() => {
		requireBillingConfiguration();
		requireAiConfiguration();
	});
	if (!ready) {
		await saveTerminalNotice(ctx, args, { content: UNAVAILABLE_REPLY });
		return { kind: 'settled' };
	}

	let usageCounted = false;
	if (args.userId) {
		const outcome = await checkAndCountUsage({
			customerId: args.userId,
			featureId: 'ai_chat_messages'
		});
		if (outcome === 'denied') {
			console.warn(`[createAIResponse] AI chat limit reached for user ${args.userId}`);
			await saveTerminalNotice(ctx, args, {
				content: "You've reached your message limit, so this reply couldn't be generated.",
				notice: AI_CHAT_LIMIT_NOTICE
			});
			return { kind: 'settled' };
		}
		usageCounted = outcome === 'counted';
	}

	if (!aiReady(requireAiConfiguration)) {
		await refundCounted(args, usageCounted);
		await saveTerminalNotice(ctx, args, { content: UNAVAILABLE_REPLY });
		return { kind: 'settled' };
	}
	return { kind: 'generate', usageCounted };
}

async function streamReply(ctx: ConvexActionCtx, args: ReplyArgs): Promise<StreamedReply> {
	const sink = makeAgentUsageSink();
	let streamFailure: { error: unknown } | undefined;
	let failure: { error: unknown } | undefined;
	let text = '';
	try {
		const result = await aiChatAgent.streamText(
			ctx,
			{ threadId: args.threadId, userId: args.userId },
			{
				promptMessageId: args.promptMessageId,
				prepareStep: prepareToolErrorRedactionStep,
				experimental_transform: toolErrorRedactionTransform,
				onError: ({ error }) => {
					streamFailure ??= { error };
				}
			},
			{
				saveStreamDeltas: STREAM_DELTA_OPTIONS,
				usageHandler: sink.usageHandler
			}
		);
		await result.consumeStream();
		failure = streamFailure;
		if (!failure) text = await result.text;
	} catch (error) {
		failure = { error };
	}
	return { failure, text, models: sink.collect() };
}

async function storeReplyPreview(ctx: ConvexActionCtx, args: ReplyArgs, text: string) {
	const lastMessage = text.trim().slice(0, THREAD_PREVIEW_LENGTH);
	if (!lastMessage) return;
	await ctx.runMutation(internal.aiChat.threads.updateThreadMetadata, {
		threadId: args.threadId,
		lastMessage,
		lastMessageAt: Date.now()
	});
}

export default GroupImpl.make(databaseSchema, messages).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, messages, 'createAIResponse', (args) =>
			Effect.gen(function* () {
				const ctx = yield* ActionCtx;
				const turn = yield* Effect.promise(() => startTurn(ctx, args));
				if (turn.kind === 'settled') return null;

				const reply = yield* Effect.promise(() => streamReply(ctx, args));
				const usage = { feature: 'ai_chat' as const, userId: args.userId, threadId: args.threadId };
				if (reply.failure) {
					yield* Effect.promise(() => refundCounted(args, turn.usageCounted));
					yield* recordAiUsage({ ...usage, status: 'error', models: reply.models });
					yield* Effect.promise(() =>
						saveTerminalNotice(ctx, args, {
							content: "This reply couldn't be generated.",
							notice: AI_CHAT_GENERATION_FAILED_NOTICE
						})
					);
					return yield* Effect.die(reply.failure.error);
				}

				yield* recordAiUsage({ ...usage, status: 'ok', models: reply.models });
				yield* Effect.promise(() => storeReplyPreview(ctx, args, reply.text));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'getFileMetadataBatch', ({ urls }) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => getFileMetadataByUrls(ctx, urls));
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'listMessages', (args) =>
			Effect.gen(function* () {
				const { _id: userId } = yield* CurrentUser;
				const ctx = yield* QueryCtx;
				yield* ownedAiChatThread(ctx, { threadId: args.threadId, userId });
				return yield* Effect.promise(() =>
					listMessagesForThread(ctx, {
						threadId: args.threadId,
						paginationOpts: args.paginationOpts,
						streamArgs: args.streamArgs
					})
				);
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'sendMessage', (args) =>
			Effect.gen(function* () {
				if (args.prompt.length > MAX_MESSAGE_LENGTH) {
					return yield* Effect.fail(
						new AiChatRefusal({
							refusal: { code: AI_CHAT_ERROR_CODES.messageTooLong, maxLength: MAX_MESSAGE_LENGTH }
						})
					);
				}
				if (args.fileIds && args.fileIds.length > MAX_MESSAGE_FILES) {
					return yield* Effect.fail(
						new AiChatRefusal({
							refusal: { code: AI_CHAT_ERROR_CODES.tooManyFiles, maxFiles: MAX_MESSAGE_FILES }
						})
					);
				}

				const { _id: userId } = yield* CurrentUser;
				const ctx = yield* MutationCtx;
				const record = yield* ownedAiChatThread(ctx, { threadId: args.threadId, userId });

				yield* Effect.sync(() => {
					requireBillingConfiguration();
					requireAiConfiguration();
				});

				const isFirstMessage = record.lastMessageAt === undefined;
				if (record.isWarm) {
					yield* Effect.promise(() =>
						ctx.db.patch('aiChatThreads', record._id, {
							isWarm: false,
							sidebarActivityAt: getAiChatSidebarActivityAt({ ...record, isWarm: false })
						})
					);
				}

				yield* limitMessage(ctx, userId);

				const saved = yield* Effect.promise(() => saveUserMessage(ctx, args, userId, record));

				const scheduler = yield* Scheduler;
				yield* scheduler.runAfter(Duration.zero, refs.internal.aiChat.messages.createAIResponse, {
					threadId: args.threadId,
					promptMessageId: saved.messageId,
					userId
				});
				if (isFirstMessage && args.prompt.trim().length > 0) {
					yield* scheduler.runAfter(
						Duration.zero,
						refs.internal.aiChat.titles.generateThreadTitle,
						{ threadId: args.threadId, prompt: args.prompt, userId }
					);
				}

				return { messageId: saved.messageId, order: saved.message.order };
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
