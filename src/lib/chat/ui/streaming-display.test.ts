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

		expect(context.streamingKeys.has('2-0')).toBe(true);
		expect(context.streamTextMap.get(2)).toBe('Streaming response');
		expect(context.streamReasoningMap.get(2)).toBe('Thinking');
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
