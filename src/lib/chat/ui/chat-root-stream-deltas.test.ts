import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { ConvexClient } from 'convex/browser';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { StreamDelta, StreamMessage } from '@convex-dev/agent/validators';
import type { ChatSessionPort } from '../core/chat-session-port.js';
import type { DeltaCursor } from '../core/delta-stream-cursors.js';
import type { ChatMessage, ChatMessagesArgs } from '../core/types.js';
import ChatTestProvider from './test-fixtures/ChatTestProvider.svelte';
import ChatRootThreadHarness from './test-fixtures/ChatRootThreadHarness.svelte';
import { capturedChatMessages } from './test-fixtures/CapturedChatMessages.svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

// The agent component returns at most this many deltas per stream for one cursor.
const MAX_DELTAS_PER_STREAM = 100;

// Row and stream shapes captured from `listMessages` WebSocket frames on the local stack.
type CapturedRow = ChatMessage & { userId: string };
const capturedUserRow: CapturedRow = {
	_creationTime: 1792671825210.6443,
	id: 'kx79206yqkv1zea8p0h7zfmqdn8gs7ha',
	key: 'm97c01c59761dp35jz89z1gn418gsg3s-0-0',
	order: 0,
	parts: [
		{
			state: 'done',
			text: 'What does the starter use for billing? One short sentence.',
			type: 'text'
		}
	],
	role: 'user',
	status: 'success',
	stepOrder: 0,
	text: 'What does the starter use for billing? One short sentence.',
	userId: 'anon_9c245585-732e-4def-b1e7-f49fd5b6d86a'
};
const capturedAssistantRow: CapturedRow = {
	_creationTime: 1792671825361.62,
	agentName: 'Kai',
	id: 'kx7322s2gkanw1c98jh3gxf4ph8gr61b',
	key: 'm97c01c59761dp35jz89z1gn418gsg3s-0-1',
	order: 0,
	parts: [],
	role: 'assistant',
	status: 'streaming',
	stepOrder: 1,
	text: '',
	userId: 'anon_9c245585-732e-4def-b1e7-f49fd5b6d86a'
};
const capturedStreamMessage = {
	agentName: 'Kai',
	format: 'UIMessageChunk',
	model: 'google/gemma-4-26b-a4b-it',
	order: 0,
	provider: 'openrouter',
	status: 'streaming',
	stepOrder: 1,
	streamId: 'm573k0k2te8bm93jv275temw358gskj4',
	userId: 'anon_9c245585-732e-4def-b1e7-f49fd5b6d86a'
} satisfies StreamMessage;

type ServerStream = { message: StreamMessage; deltas: StreamDelta[] };
type ServerThread = { page: ChatMessage[]; streams: ServerStream[] };

/**
 * A UIMessageChunk stream with the captured prelude (`start`, `start-step`,
 * `text-start`) followed by text delta records. Record 50 holds three parts,
 * like the captured multi-part deltas, so cursors count parts, not records.
 */
function textStream(streamId: string, label: string, records: number) {
	const textId = `gen-${streamId}`;
	const deltas: StreamDelta[] = [];
	const push = (parts: Array<Record<string, unknown>>) => {
		const start = deltas.at(-1)?.end ?? 0;
		deltas.push({ streamId, start, end: start + parts.length, parts });
	};
	const textDelta = (delta: string) => ({ type: 'text-delta', id: textId, delta });
	push([{ type: 'start' }]);
	push([{ type: 'start-step' }]);
	push([{ type: 'text-start', id: textId }]);
	while (deltas.length < records) {
		const index = deltas.length;
		push(
			index === 50
				? [
						textDelta(`${label}${index}a `),
						textDelta(`${label}${index}b `),
						textDelta(`${label}${index}c `)
					]
				: [textDelta(`${label}${index} `)]
		);
	}
	/** Display text after the first `count` records. */
	const textThrough = (count: number) =>
		deltas
			.slice(0, count)
			.flatMap((delta) => delta.parts as Array<{ delta?: string }>)
			.map((part) => part.delta ?? '')
			.join('');
	return { deltas, textThrough, fullText: textThrough(records) };
}

function streamingThread(threadId: string, stream: ReturnType<typeof textStream>): ServerThread {
	const streamId = stream.deltas[0]!.streamId;
	return {
		page: [
			{ ...capturedUserRow, key: `${threadId}-0-0` },
			{ ...capturedAssistantRow, key: `${threadId}-0-1` }
		],
		streams: [{ message: { ...capturedStreamMessage, streamId }, deltas: stream.deltas }]
	};
}

/**
 * Fake Convex client keyed by query args. `deliver()` pushes the current server
 * result to every subscription whose result changed, like a Convex update.
 */
function createFakeConvex(server: Map<string, ServerThread>) {
	const results = new Map<string, unknown>();
	const subscriptions = new Set<{
		key: string;
		args: ChatMessagesArgs;
		callback: (value: unknown) => void;
		delivered?: string;
	}>();
	const deltaRequests: Array<{ threadId: string; cursors: DeltaCursor[] }> = [];
	const key = (name: string, args: unknown) => JSON.stringify([name, args]);

	const resolve = (args: ChatMessagesArgs) => {
		const thread = server.get(args.threadId!) ?? { page: [], streams: [] };
		const envelope = { isDone: true, continueCursor: '' };
		if (args.streamArgs?.kind === 'deltas') {
			const deltas = args.streamArgs.cursors.flatMap(({ streamId, cursor }) =>
				(thread.streams.find((stream) => stream.message.streamId === streamId)?.deltas ?? [])
					.filter((delta) => delta.start >= cursor)
					.slice(0, MAX_DELTAS_PER_STREAM)
			);
			return { ...envelope, page: [], streams: { kind: 'deltas', deltas } };
		}
		return {
			...envelope,
			page: thread.page,
			streams: { kind: 'list', messages: thread.streams.map((stream) => stream.message) }
		};
	};

	const client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: (name: string, args: unknown) => results.get(key(name, args)) },
		onUpdate: (
			query: FunctionReference<'query'>,
			args: ChatMessagesArgs,
			callback: (value: unknown) => void
		) => {
			if (args.streamArgs?.kind === 'deltas') {
				deltaRequests.push({ threadId: args.threadId!, cursors: args.streamArgs.cursors });
			}
			const subscription = { key: key(getFunctionName(query), args), args, callback };
			subscriptions.add(subscription);
			return () => {
				subscriptions.delete(subscription);
				if (![...subscriptions].some((other) => other.key === subscription.key)) {
					results.delete(subscription.key);
				}
			};
		}
	};

	/** Delivers one round of changed results; returns whether anything was delivered. */
	const deliver = () => {
		flushSync();
		let delivered = false;
		for (const subscription of subscriptions) {
			const value = resolve(subscription.args);
			const json = JSON.stringify(value);
			if (subscription.delivered === json) continue;
			subscription.delivered = json;
			results.set(subscription.key, value);
			subscription.callback(value);
			delivered = true;
		}
		flushSync();
		return delivered;
	};

	/** Delivers until every subscription is current. */
	const settle = () => {
		for (let round = 0; round < 20; round++) if (!deliver()) return;
		throw new Error('Subscriptions did not settle');
	};

	return { client: client as unknown as ConvexClient, deliver, settle, deltaRequests };
}

const session: ChatSessionPort = {
	threadId: null,
	isNewConversation: false,
	threadGeneration: 0,
	isSending: false,
	isAwaitingStream: false,
	setAwaitingStream: () => {},
	streamCache: {
		getCachedReasoning: () => undefined,
		updateReasoningCache: () => {},
		clearReasoningCache: () => {},
		updateStatusCache: () => {}
	}
};

type HarnessProps = { threadId: string; session: ChatSessionPort };
let component: { setContentProps: (next: HarnessProps) => void } | undefined;

function mountChat(client: ConvexClient, threadId: string) {
	component = mount(ChatTestProvider<HarnessProps>, {
		target: document.body,
		props: {
			client,
			content: ChatRootThreadHarness,
			contentProps: { threadId, session },
			provideTolgee: false
		}
	});
	return component;
}

function assistantTexts() {
	return (capturedChatMessages.context?.displayMessages ?? [])
		.filter((message) => message.role === 'assistant')
		.map((message) => message.displayText);
}

async function expectAssistantTexts(texts: string[]) {
	await vi.waitFor(() => expect(assistantTexts()).toEqual(texts));
}

/** Cursor values requested for one stream, without consecutive repeats. */
function requestedCursors(
	requests: ReturnType<typeof createFakeConvex>['deltaRequests'],
	streamId: string
) {
	return requests
		.flatMap((request) => request.cursors.filter((cursor) => cursor.streamId === streamId))
		.map((cursor) => cursor.cursor)
		.filter((cursor, index, cursors) => cursor !== cursors[index - 1]);
}

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	capturedChatMessages.context = undefined;
	document.body.replaceChildren();
});

describe('ChatRoot stream deltas', () => {
	it('keeps reading a stream past the 100 deltas of one page', async () => {
		const stream = textStream(capturedStreamMessage.streamId, 'a', 250);
		const server = new Map([['thread-a', streamingThread('thread-a', stream)]]);
		const convex = createFakeConvex(server);
		mountChat(convex.client, 'thread-a');

		convex.deliver();
		convex.deliver();
		await expectAssistantTexts([stream.textThrough(100)]);

		convex.deliver();
		await expectAssistantTexts([stream.textThrough(200)]);

		convex.settle();
		await expectAssistantTexts([stream.fullText]);
		expect(requestedCursors(convex.deltaRequests, capturedStreamMessage.streamId)).toEqual([
			0,
			stream.deltas[99]!.end,
			stream.deltas[199]!.end,
			stream.deltas[249]!.end
		]);
	});

	it('reads a stream that starts after the previous one ended from cursor 0', async () => {
		const first = textStream('stream-first', 'f', 120);
		const second = textStream('stream-second', 's', 30);
		const server = new Map([['thread-a', streamingThread('thread-a', first)]]);
		const convex = createFakeConvex(server);
		mountChat(convex.client, 'thread-a');
		convex.settle();
		await expectAssistantTexts([first.fullText]);

		const savedReply = {
			...capturedAssistantRow,
			status: 'success',
			text: first.fullText,
			parts: [{ type: 'text', text: first.fullText }]
		} satisfies ChatMessage;
		server.set('thread-a', { page: [capturedUserRow, savedReply], streams: [] });
		convex.settle();
		await expectAssistantTexts([first.fullText]);

		const next = streamingThread('thread-a', second);
		server.set('thread-a', {
			page: [
				capturedUserRow,
				savedReply,
				...next.page.map((row) => ({ ...row, id: `${row.id}-next`, order: 1 }))
			],
			streams: next.streams.map((stream) => ({
				...stream,
				message: { ...stream.message, order: 1 }
			}))
		});
		convex.settle();

		await expectAssistantTexts([first.fullText, second.fullText]);
		expect(requestedCursors(convex.deltaRequests, 'stream-second')).toEqual([
			0,
			second.deltas.at(-1)!.end
		]);
	});

	it('shows only the current thread stream across thread switches', async () => {
		const streamA = textStream('stream-a', 'a', 150);
		const streamB = textStream('stream-b', 'b', 120);
		const server = new Map([
			['thread-a', streamingThread('thread-a', streamA)],
			['thread-b', streamingThread('thread-b', streamB)]
		]);
		const convex = createFakeConvex(server);
		const chat = mountChat(convex.client, 'thread-a');
		convex.settle();
		await expectAssistantTexts([streamA.fullText]);

		chat.setContentProps({ threadId: 'thread-b', session });
		flushSync();
		expect(assistantTexts()).toEqual([]);
		convex.settle();
		await expectAssistantTexts([streamB.fullText]);

		chat.setContentProps({ threadId: 'thread-a', session });
		flushSync();
		expect(assistantTexts()).toEqual([]);
		convex.settle();
		await expectAssistantTexts([streamA.fullText]);

		const streamThread = new Map([
			['stream-a', 'thread-a'],
			['stream-b', 'thread-b']
		]);
		for (const request of convex.deltaRequests) {
			for (const { streamId } of request.cursors) {
				expect(streamThread.get(streamId)).toBe(request.threadId);
			}
		}
		expect(requestedCursors(convex.deltaRequests, 'stream-b')[0]).toBe(0);
	});

	it('rereads a stream from cursor 0 after visiting a thread without streams', async () => {
		const streamA = textStream('stream-a', 'a', 150);
		const server = new Map([
			['thread-a', streamingThread('thread-a', streamA)],
			['thread-b', { page: [capturedUserRow], streams: [] }]
		]);
		const convex = createFakeConvex(server);
		const chat = mountChat(convex.client, 'thread-a');
		convex.settle();
		await expectAssistantTexts([streamA.fullText]);

		chat.setContentProps({ threadId: 'thread-b', session });
		convex.settle();
		await expectAssistantTexts([]);

		const requestsBeforeReturn = convex.deltaRequests.length;
		chat.setContentProps({ threadId: 'thread-a', session });
		convex.settle();
		await expectAssistantTexts([streamA.fullText]);
		expect(requestedCursors(convex.deltaRequests.slice(requestsBeforeReturn), 'stream-a')[0]).toBe(
			0
		);
	});
});
