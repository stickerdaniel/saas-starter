import { describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@convex-dev/agent';
import type { StreamMessage } from '@convex-dev/agent/validators';
import type { ChatMessage } from '../core/types.js';
import {
	buildDisplayMessages,
	buildTransformContext,
	getActiveStreamIds,
	hasStreamingAssistantMessage
} from './streaming-display.js';
import type { StreamCacheManager } from '../core/stream-cache.js';

function createStreamCache(): StreamCacheManager {
	return {
		getCachedReasoning: vi.fn(),
		updateReasoningCache: vi.fn(),
		clearReasoningCache: vi.fn(),
		getCachedStatus: vi.fn(),
		updateStatusCache: vi.fn(),
		hasStatusCache: vi.fn(),
		clear: vi.fn()
	} as unknown as StreamCacheManager;
}

function createAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: 'msg-1',
		_creationTime: 1,
		role: 'assistant',
		status: 'success',
		order: 1,
		text: 'Persisted response',
		...overrides
	};
}

function createStreamMessage(overrides: Partial<StreamMessage> = {}): StreamMessage {
	return {
		streamId: 'stream-1',
		order: 1,
		stepOrder: 0,
		status: 'streaming',
		agentName: undefined,
		format: 'UIMessageChunk',
		...overrides
	} as StreamMessage;
}

function createStreamingUIMessage(overrides: Partial<UIMessage> = {}): UIMessage {
	return {
		id: 'stream:1',
		key: 'thread-1-1-0',
		order: 1,
		stepOrder: 0,
		status: 'streaming',
		agentName: 'assistant',
		text: 'Streaming response',
		_creationTime: 1,
		role: 'assistant',
		parts: [{ type: 'text', text: 'Streaming response' }],
		...overrides
	};
}

describe('getActiveStreamIds', () => {
	it('returns ids for stream lifecycle statuses used by the delta query', () => {
		expect(
			getActiveStreamIds([
				createStreamMessage({ streamId: 'streaming', status: 'streaming' }),
				createStreamMessage({ streamId: 'finished', status: 'finished' }),
				createStreamMessage({ streamId: 'aborted', status: 'aborted' }),
				createStreamMessage({ streamId: 'ignored', status: 'pending' as StreamMessage['status'] })
			])
		).toEqual(['streaming', 'finished', 'aborted']);
	});
});

describe('buildTransformContext', () => {
	it('populates stream maps and updates caches from streaming UI messages', () => {
		const streamCache = createStreamCache();
		const context = buildTransformContext({
			streamMessages: [createStreamMessage({ order: 2, status: 'finished' })],
			streamingUIMessages: [
				createStreamingUIMessage({
					order: 2,
					status: 'success',
					parts: [
						{ type: 'reasoning', text: 'Thinking' },
						{ type: 'text', text: 'Done' }
					]
				})
			],
			streamCache
		});

		expect(context.streamMessageMap.get(2)?.text).toBe('Streaming response');
		expect(streamCache.updateStatusCache).toHaveBeenCalledWith(2, 'finished');
		expect(streamCache.updateReasoningCache).toHaveBeenCalledWith(2, 'Thinking');
	});
});

describe('buildDisplayMessages', () => {
	it('uses simple transformation when there are no streams', () => {
		const message = createAssistantMessage({ text: 'Persisted response' });
		const displayMessages = buildDisplayMessages({
			allMessages: [message],
			streamMessages: [],
			streamingUIMessages: [],
			streamCache: createStreamCache()
		});

		expect(displayMessages[0]?.displayText).toBe('Persisted response');
		expect(displayMessages[0]?.isStreaming).toBe(false);
	});

	it('applies stream-derived text and parts when a message is being streamed', () => {
		const message = createAssistantMessage({ order: 3, text: 'Persisted response' });
		const displayMessages = buildDisplayMessages({
			allMessages: [message],
			streamMessages: [createStreamMessage({ order: 3, status: 'streaming' })],
			streamingUIMessages: [
				createStreamingUIMessage({
					order: 3,
					text: 'Streaming response',
					parts: [{ type: 'text', text: 'Streaming response' }]
				})
			],
			streamCache: createStreamCache()
		});

		expect(displayMessages[0]?.displayText).toBe('Streaming response');
		expect(displayMessages[0]?.parts).toEqual([{ type: 'text', text: 'Streaming response' }]);
		expect(displayMessages[0]?.isStreaming).toBe(true);
	});

	it('creates a synthetic assistant row while a stream exists before the persisted assistant message arrives', () => {
		const userMessage = {
			...createAssistantMessage({
				id: 'user-1',
				role: 'user',
				order: 1,
				text: 'Need help',
				message: { role: 'user', content: 'Need help' }
			}),
			parts: undefined
		} as ChatMessage;

		const displayMessages = buildDisplayMessages({
			allMessages: [userMessage],
			streamMessages: [createStreamMessage({ order: 2, status: 'streaming' })],
			streamingUIMessages: [
				createStreamingUIMessage({
					id: 'stream:2',
					order: 2,
					status: 'streaming',
					text: '',
					parts: []
				})
			],
			streamCache: createStreamCache()
		});

		expect(displayMessages).toHaveLength(2);
		expect(displayMessages[1]?.id).toBe('stream:2');
		expect(displayMessages[1]?.role).toBe('assistant');
		expect(displayMessages[1]?.status).toBe('streaming');
		expect(displayMessages[1]?.hasReasoningStream).toBe(true);
		expect(displayMessages[1]?.displayText).toBe('');
		expect(displayMessages[1]?.displayReasoning).toBe('');
	});

	it('merges a live streamed step into persisted grouped assistant parts without dropping earlier steps', () => {
		const message = createAssistantMessage({
			order: 4,
			parts: [
				{ type: 'reasoning', text: 'Find coordinates', streamPartId: 'reason-1' },
				{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' },
				{ type: 'reasoning', text: 'Check forecast', streamPartId: 'reason-2' },
				{ type: 'tool-getWeather', toolCallId: 'tool-2', state: 'output-available' }
			]
		});

		const displayMessages = buildDisplayMessages({
			allMessages: [message],
			streamMessages: [createStreamMessage({ order: 4, status: 'streaming' })],
			streamingUIMessages: [
				createStreamingUIMessage({
					order: 4,
					text: '',
					parts: [{ type: 'reasoning', text: 'Draft final answer' }]
				})
			],
			streamCache: createStreamCache()
		});

		expect(displayMessages[0]?.parts).toEqual([
			{ type: 'reasoning', text: 'Find coordinates', streamPartId: 'reason-1' },
			{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' },
			{ type: 'reasoning', text: 'Check forecast', streamPartId: 'reason-2' },
			{ type: 'tool-getWeather', toolCallId: 'tool-2', state: 'output-available' },
			{ type: 'reasoning', text: 'Draft final answer' }
		]);
		expect(displayMessages[0]?.isStreaming).toBe(true);
	});

	it('does not invent duplicate reasoning blocks when the grouped live stream repeats an existing prefix', () => {
		const message = createAssistantMessage({
			order: 5,
			parts: [
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Find coordinates' },
				{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' }
			]
		});

		const displayMessages = buildDisplayMessages({
			allMessages: [message],
			streamMessages: [createStreamMessage({ order: 5, status: 'streaming' })],
			streamingUIMessages: [
				createStreamingUIMessage({
					order: 5,
					text: '',
					parts: [
						{ type: 'step-start' },
						{ type: 'reasoning', text: 'Find coordinates' },
						{
							type: 'tool-getGeocoding',
							toolCallId: 'tool-1',
							state: 'output-available',
							input: { location: 'Tokyo' },
							output: { latitude: 35.68, longitude: 139.69 }
						},
						{ type: 'step-start' },
						{ type: 'reasoning', text: 'Check forecast' }
					]
				})
			],
			streamCache: createStreamCache()
		});

		expect(displayMessages[0]?.parts).toEqual([
			{ type: 'step-start' },
			{ type: 'reasoning', text: 'Find coordinates' },
			{
				type: 'tool-getGeocoding',
				toolCallId: 'tool-1',
				state: 'output-available',
				input: { location: 'Tokyo' },
				output: { latitude: 35.68, longitude: 139.69 }
			},
			{ type: 'step-start' },
			{ type: 'reasoning', text: 'Check forecast' }
		]);
	});
});

describe('hasStreamingAssistantMessage', () => {
	it('returns true only when an assistant message is still pending or streaming', () => {
		expect(
			hasStreamingAssistantMessage([
				createAssistantMessage({ status: 'success' }),
				createAssistantMessage({ id: 'msg-2', status: 'streaming' })
			] as ReturnType<typeof buildDisplayMessages>)
		).toBe(true);
		expect(
			hasStreamingAssistantMessage([createAssistantMessage({ status: 'success' })] as ReturnType<
				typeof buildDisplayMessages
			>)
		).toBe(false);
	});
});
