// @vitest-environment node
/// <reference types="vite/client" />
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import rateLimiterSchema from '../../../../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OptimisticLocalStore } from 'convex/browser';
import { createOptimisticUpdate } from '../../../chat/core/optimistic';
import { StreamCacheManager } from '../../../chat/core/stream-cache';
import { redactLanguageModelProviderErrors } from '../../../chat/core/tool-error-redaction';
import type { MessagesQueryResponse } from '../../../chat/core/types';
import type { AwaitedTurn } from '../../../chat/core/chat-session-port';
import {
	buildDisplayMessages,
	decodeStreamingUIMessages,
	dedupeChatDisplayMessages,
	getActiveStreamIds,
	getListStreamMessages,
	getNormalizedMessages,
	getStreamDeltas,
	hasAwaitedResponseStarted
} from '../../../chat/ui/streaming-display';
import { api, components, internal } from '../../_generated/api';
// Imported before `convexTest.modules`, which loads every module at once: a
// module importing `autumn` while this mock still awaits `importOriginal`
// would receive the original.
import { checkAndCountUsage, refundUsage } from '../../autumn';
import type * as Autumn from '../../autumn';
import authSchema from '../../betterAuth/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';
import { AI_CHAT_GENERATION_FAILED_NOTICE } from '../../constants';
import schema from '../../schema';
import { aiChatAgent } from '../agent';

vi.mock('../../autumn', async (importOriginal) => ({
	...(await importOriginal<typeof Autumn>()),
	checkAndCountUsage: vi.fn(),
	refundUsage: vi.fn()
}));

const checkAndCountUsageMock = vi.mocked(checkAndCountUsage);
const refundUsageMock = vi.mocked(refundUsage);

// Each model call takes the next scripted step: a rejection, as when the
// provider request fails, or the parts its stream emits. The wrapper is the
// one the production model gets from `orModel`.
let modelSteps: Array<Error | LanguageModelV4StreamPart[]> = [];
aiChatAgent.options.languageModel = redactLanguageModelProviderErrors(
	new MockLanguageModelV4({
		doStream: async () => {
			const step = modelSteps.shift();
			if (!step) throw new Error('No scripted model step left');
			if (step instanceof Error) throw step;
			return {
				stream: new ReadableStream({
					start(controller) {
						for (const part of step) controller.enqueue(part);
						controller.close();
					}
				})
			};
		}
	})
);

const agentModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);
const rateLimiterModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/rate-limiter/dist/component/**/*.js')
);
const betterAuthModules = await preloadModules(import.meta.glob('../../betterAuth/**/*.ts'));

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 }
};

const textStep = (text: string): LanguageModelV4StreamPart[] => [
	{ type: 'stream-start', warnings: [] },
	{ type: 'text-start', id: 'text-1' },
	{ type: 'text-delta', id: 'text-1', delta: text },
	{ type: 'text-end', id: 'text-1' },
	{ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }
];

const geocodingStep: LanguageModelV4StreamPart[] = [
	{ type: 'stream-start', warnings: [] },
	{
		type: 'tool-call',
		toolCallId: 'call-1',
		toolName: 'getGeocoding',
		input: JSON.stringify({ location: 'Berlin' })
	},
	{ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage }
];

const GENERATION_FAILED = "This reply couldn't be generated.";

async function setup() {
	const t = convexTest(schema, convexModules);
	t.registerComponent('agent', agentSchema, agentModules);
	t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
	t.registerComponent('betterAuth', authSchema, betterAuthModules);

	const now = Date.now();
	const user = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				name: 'Ada',
				email: 'ada@example.com',
				emailVerified: true,
				role: 'user',
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	const session = (await t.mutation(components.betterAuth.adapter.create, {
		input: {
			model: 'session',
			data: {
				userId: user._id,
				token: crypto.randomUUID(),
				expiresAt: now + 60_000,
				createdAt: now,
				updatedAt: now
			}
		}
	})) as { _id: string };
	const { _id: threadId } = await t.mutation(components.agent.threads.createThread, {
		userId: user._id
	});
	await t.run((ctx) =>
		ctx.db.insert('aiChatThreads', { threadId, userId: user._id, createdAt: now, isWarm: false })
	);
	const asUser = t.withIdentity({ subject: user._id, sessionId: session._id });

	return {
		t,
		threadId,
		userId: user._id,
		/** Saves a prompt as the composer does. Its reply job stays queued; tests run it directly. */
		send: async (prompt: string) => {
			vi.useFakeTimers();
			try {
				return await asUser.mutation(api.aiChat.messages.sendMessage, { threadId, prompt });
			} finally {
				vi.useRealTimers();
			}
		},
		reply: (promptMessageId: string) =>
			t.action(internal.aiChat.messages.createAIResponse, {
				threadId,
				promptMessageId,
				userId: user._id
			}),
		messages: async () => {
			const { page } = await t.query(components.agent.messages.listMessagesByThreadId, {
				threadId,
				order: 'asc',
				paginationOpts: { cursor: null, numItems: 50 }
			});
			return page;
		},
		/** The page the AI chat route renders, through the app's own listing query. */
		listing: (numItems = 50): Promise<MessagesQueryResponse> =>
			asUser.query(api.aiChat.messages.listMessages, {
				threadId,
				paginationOpts: { cursor: null, numItems }
			}),
		/** The deltas ChatRoot's second subscription reads for the listed streams. */
		deltas: (streamIds: string[]): Promise<MessagesQueryResponse> =>
			asUser.query(api.aiChat.messages.listMessages, {
				threadId,
				paginationOpts: { cursor: null, numItems: 0 },
				streamArgs: {
					kind: 'deltas',
					cursors: streamIds.map((streamId) => ({ streamId, cursor: 0 }))
				}
			}),
		/** Opens a live agent stream at `order` that has written `text` and has no saved row yet. */
		stream: async (order: number, text: string) => {
			const streamId = await t.mutation(components.agent.streams.create, {
				threadId,
				order,
				stepOrder: 0,
				format: 'UIMessageChunk',
				agentName: aiChatAgent.options.name
			});
			await t.mutation(components.agent.streams.addDelta, {
				streamId,
				start: 0,
				end: 3,
				parts: [
					{ type: 'start' },
					{ type: 'text-start', id: 'text-1' },
					{ type: 'text-delta', id: 'text-1', delta: text }
				]
			});
		},
		sidebarPreview: () =>
			t.run(async (ctx) => {
				const row = await ctx.db
					.query('aiChatThreads')
					.withIndex('by_thread', (q) => q.eq('threadId', threadId))
					.first();
				return row?.lastMessage;
			})
	};
}

describe('AI chat reply outcome', () => {
	beforeEach(() => {
		modelSteps = [];
		// Non-sentinel keys make both capabilities ready; Autumn and the model stay doubles.
		vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_reply_outcome');
		vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-reply-outcome');
		checkAndCountUsageMock.mockReset().mockResolvedValue('counted');
		refundUsageMock.mockReset().mockResolvedValue({ status: 'refunded' });
		// The agent reports provider failures on the console; these tests read the thread instead.
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('returns the order the saved prompt holds in the thread', async () => {
		const chat = await setup();

		const first = await chat.send('First');
		const second = await chat.send('Second');

		const saved = await chat.messages();
		expect(saved.map(({ _id, order }) => ({ _id, order }))).toEqual([
			{ _id: first.messageId, order: first.order },
			{ _id: second.messageId, order: second.order }
		]);
		expect(second.order).toBeGreaterThan(first.order);
	});

	it('places a quota notice at its own prompt after a later prompt was saved', async () => {
		const chat = await setup();
		const a = await chat.send('Prompt A');
		const b = await chat.send('Prompt B');
		checkAndCountUsageMock.mockResolvedValue('denied');
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		await chat.reply(a.messageId);

		const messages = await chat.messages();
		const notice = messages.find((message) => message.message?.role === 'assistant');
		expect(notice).toMatchObject({ order: a.order });
		expect(notice?.order).not.toBe(b.order);
		expect(messages.map(({ _id }) => _id)).toEqual([a.messageId, notice?._id, b.messageId]);
		expect(refundUsageMock).not.toHaveBeenCalled();
	});

	it.each([
		{ failure: 'before any output', steps: [new Error('provider unavailable')] },
		{
			failure: 'inside the first stream',
			steps: [
				[
					{ type: 'stream-start', warnings: [] },
					{ type: 'text-start', id: 'text-1' },
					{ type: 'text-delta', id: 'text-1', delta: 'Partial' },
					{ type: 'error', error: new Error('provider stream broke') }
				] satisfies LanguageModelV4StreamPart[]
			]
		},
		{
			failure: 'after a successful tool step',
			steps: [geocodingStep, new Error('provider unavailable')],
			toolResult: { latitude: 52.5, longitude: 13.4, name: 'Berlin' }
		}
	])(
		'refunds once and ends the turn with a notice when the provider fails $failure',
		async ({ steps, toolResult }) => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () =>
					Response.json({ results: [{ latitude: 52.5, longitude: 13.4, name: 'Berlin' }] })
				)
			);
			const chat = await setup();
			const prompt = await chat.send('Weather in Berlin?');
			modelSteps = [...steps];

			await expect(chat.reply(prompt.messageId)).rejects.toThrow();

			expect(modelSteps).toEqual([]);
			expect(refundUsageMock).toHaveBeenCalledTimes(1);
			expect(refundUsageMock).toHaveBeenCalledWith({
				customerId: chat.userId,
				featureId: 'ai_chat_messages'
			});
			const messages = await chat.messages();
			expect(messages[messages.length - 1]).toMatchObject({
				order: prompt.order,
				status: 'success',
				text: GENERATION_FAILED,
				message: { role: 'assistant' }
			});
			expect(messages.filter(({ text }) => text === GENERATION_FAILED)).toHaveLength(1);
			if (toolResult) {
				expect(messages).toContainEqual(
					expect.objectContaining({
						message: expect.objectContaining({
							role: 'tool',
							content: [expect.objectContaining({ output: { type: 'json', value: toolResult } })]
						})
					})
				);
			}
			expect(await chat.sidebarPreview()).toBe('Weather in Berlin?');
		}
	);

	it('settles the turn when the agent cannot save its final step', async () => {
		const chat = await setup();
		const prompt = await chat.send('Hello?');
		modelSteps = [textStep('Hello there')];
		// The agent saves the final step together with finishing its stream, the only
		// save that carries `finishStreamId`. Rejecting it leaves the agent's reply row
		// pending and its stream live.
		const streamText = aiChatAgent.streamText.bind(aiChatAgent);
		vi.spyOn(aiChatAgent, 'streamText').mockImplementation((ctx, ...rest) => {
			const runMutation: typeof ctx.runMutation = (reference, ...mutationArgs) => {
				const [input] = mutationArgs;
				if (typeof input === 'object' && input !== null && 'finishStreamId' in input) {
					return Promise.reject(new Error('final save failed'));
				}
				return ctx.runMutation(reference, ...mutationArgs);
			};
			return streamText({ ...ctx, runMutation }, ...rest);
		});

		await expect(chat.reply(prompt.messageId)).rejects.toThrow('final save failed');

		expect(refundUsageMock).toHaveBeenCalledTimes(1);
		const { page, streams } = await chat.listing();
		const replies = page.filter(
			({ role, order }) => role === 'assistant' && order === prompt.order
		);
		expect(replies).toContainEqual(
			expect.objectContaining({
				status: 'success',
				text: GENERATION_FAILED,
				metadata: expect.objectContaining({
					providerMetadata: { system: { notice: AI_CHAT_GENERATION_FAILED_NOTICE } }
				})
			})
		);
		// The composer stays busy while any assistant message is pending or streaming.
		expect(replies.map(({ status }) => status)).not.toContain('pending');
		expect(replies.map(({ status }) => status)).not.toContain('streaming');
		expect(streams?.kind === 'list' ? streams.messages : []).toEqual([]);
	});

	it('keeps the counted unit and adds no notice when the reply is delivered', async () => {
		const chat = await setup();
		const prompt = await chat.send('Hello?');
		modelSteps = [textStep('Hello there')];

		await chat.reply(prompt.messageId);

		expect(refundUsageMock).not.toHaveBeenCalled();
		const messages = await chat.messages();
		expect(messages[messages.length - 1]).toMatchObject({
			order: prompt.order,
			status: 'success',
			text: 'Hello there'
		});
		expect(messages.some(({ text }) => text === GENERATION_FAILED)).toBe(false);
		expect(await chat.sidebarPreview()).toBe('Hello there');
	});
});

/**
 * The messages ChatRoot renders from a listing: the page, plus the stream-only
 * messages it decodes from the deltas of the listed streams.
 */
async function render(chat: Awaited<ReturnType<typeof setup>>, listing: MessagesQueryResponse) {
	const streamMessages = getListStreamMessages(listing);
	const deltas =
		streamMessages.length > 0
			? getStreamDeltas(await chat.deltas(getActiveStreamIds(streamMessages)))
			: [];
	return dedupeChatDisplayMessages(
		buildDisplayMessages({
			allMessages: getNormalizedMessages(listing),
			streamingUIMessages: await decodeStreamingUIMessages(chat.threadId, streamMessages, deltas),
			streamCache: new StreamCacheManager()
		})
	);
}

describe('the turn a sent prompt waits on', () => {
	beforeEach(() => {
		modelSteps = [];
		vi.stubEnv('AUTUMN_SECRET_KEY', 'am_sk_test_reply_outcome');
		vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-reply-outcome');
		checkAndCountUsageMock.mockReset().mockResolvedValue('counted');
		refundUsageMock.mockReset().mockResolvedValue({ status: 'refunded' });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	type Chat = Awaited<ReturnType<typeof setup>>;
	type Prompt = Awaited<ReturnType<Chat['send']>>;
	const responses: Record<string, (chat: Chat, prompt: Prompt) => Promise<unknown>> = {
		reply: (chat, prompt) => {
			modelSteps = [textStep(`Answer at ${prompt.order}`)];
			return chat.reply(prompt.messageId);
		},
		'limit notice': (chat, prompt) => {
			checkAndCountUsageMock.mockResolvedValueOnce('denied');
			return chat.reply(prompt.messageId);
		},
		'stream without a saved row': (chat, prompt) =>
			chat.stream(prompt.order, `Streaming at ${prompt.order}`)
	};

	it.each(Object.entries(responses))(
		"is settled by its own %s and not by an earlier prompt's",
		async (_kind, respond) => {
			const chat = await setup();
			const a = await chat.send('Prompt A');
			const b = await chat.send('Prompt B');
			const awaitingB: AwaitedTurn = { kind: 'accepted', order: b.order };

			await respond(chat, a);
			const afterA = await render(chat, await chat.listing());
			expect(afterA).toContainEqual(expect.objectContaining({ role: 'assistant', order: a.order }));
			expect(hasAwaitedResponseStarted(afterA, awaitingB)).toBe(false);

			await respond(chat, b);
			expect(hasAwaitedResponseStarted(await render(chat, await chat.listing()), awaitingB)).toBe(
				true
			);
		}
	);

	it('is settled by a reply whose prompt is outside the loaded page', async () => {
		const chat = await setup();
		const prompt = await chat.send('Hello?');
		modelSteps = [textStep('Hello there')];
		await chat.reply(prompt.messageId);

		const rendered = await render(chat, await chat.listing(1));

		expect(rendered.map(({ role }) => role)).toEqual(['assistant']);
		expect(hasAwaitedResponseStarted(rendered, { kind: 'accepted', order: prompt.order })).toBe(
			true
		);
	});

	it('ends once its turn has left the loaded page unseen', async () => {
		const chat = await setup();
		const prompt = await chat.send('Hello?');
		const awaiting: AwaitedTurn = { kind: 'accepted', order: prompt.order };
		// A page showing only the prompt still waits for its response.
		expect(hasAwaitedResponseStarted(await render(chat, await chat.listing(1)), awaiting)).toBe(
			false
		);
		modelSteps = [textStep('Hello there')];
		await chat.reply(prompt.messageId);
		// Another device continues the thread while this client misses the reply.
		await chat.t.mutation(components.agent.messages.addMessages, {
			threadId: chat.threadId,
			messages: Array.from({ length: 2 }, (_, turn) => [
				{ message: { role: 'user' as const, content: `Question ${turn}` } },
				{ message: { role: 'assistant' as const, content: `Answer ${turn}` } }
			]).flat()
		});

		const rendered = await render(chat, await chat.listing(2));

		expect(rendered.every(({ order }) => order > prompt.order)).toBe(true);
		expect(hasAwaitedResponseStarted(rendered, awaiting)).toBe(true);
	});

	it('shows the optimistic prompt after a long history at the order the send assigns', async () => {
		const chat = await setup();
		await chat.t.mutation(components.agent.messages.addMessages, {
			threadId: chat.threadId,
			messages: Array.from({ length: 20 }, (_, turn) => [
				{ message: { role: 'user' as const, content: `Question ${turn}` } },
				{ message: { role: 'assistant' as const, content: `Answer ${turn}` } }
			]).flat()
		});
		const queryArgs = {
			threadId: chat.threadId,
			paginationOpts: { numItems: 10, cursor: null },
			streamArgs: { kind: 'list' as const, startOrder: 0 }
		};
		const listing = await chat.listing(10);
		let optimistic: MessagesQueryResponse = listing;
		const store = {
			getQuery: () => optimistic,
			setQuery: (_query: unknown, _args: unknown, value: MessagesQueryResponse) => {
				optimistic = value;
			}
		} as unknown as OptimisticLocalStore;

		createOptimisticUpdate(api.aiChat.messages.listMessages, queryArgs, 'user', 'Next')(store);
		const rendered = await render(chat, optimistic);
		const sent = await chat.send('Next');

		// The page holds the newest turns, whose orders exceed its length.
		expect(Math.max(...listing.page.map(({ order }) => order))).toBeGreaterThan(
			listing.page.length
		);
		expect(rendered[rendered.length - 1]).toMatchObject({
			role: 'user',
			text: 'Next',
			order: sent.order,
			metadata: { optimistic: true }
		});
	});
});
