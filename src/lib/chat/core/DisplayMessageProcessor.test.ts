/**
 * Unit tests for DisplayMessageProcessor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	resolveReasoning,
	transformToDisplayMessage,
	transformToDisplayMessageSimple,
	type TransformContext
} from './DisplayMessageProcessor.js';
import type { ChatMessage, MessagePart } from './types.js';
import type { StreamCacheManager } from './StreamProcessor.js';

// Mock StreamCacheManager
function createMockStreamCache(cachedReasoning?: Map<number, string>): StreamCacheManager {
	const cache = cachedReasoning ?? new Map<number, string>();
	return {
		getCachedReasoning: vi.fn((order: number) => cache.get(order)),
		updateReasoningCache: vi.fn((order: number, reasoning: string) => cache.set(order, reasoning)),
		clearReasoningCache: vi.fn((order: number) => cache.delete(order)),
		getCachedStatus: vi.fn(),
		updateStatusCache: vi.fn(),
		hasStatusCache: vi.fn(),
		clear: vi.fn()
	} as unknown as StreamCacheManager;
}

// Factory for creating test messages
function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: 'msg-1',
		_creationTime: Date.now(),
		role: 'assistant',
		status: 'success',
		order: 0,
		text: 'Hello, world!',
		...overrides
	};
}

describe('resolveReasoning', () => {
	let mockCache: StreamCacheManager;

	beforeEach(() => {
		mockCache = createMockStreamCache();
	});

	it('prefers stream reasoning when available', () => {
		const msg = createMessage({
			parts: [{ type: 'reasoning', reasoning: 'persisted reasoning' }] as MessagePart[]
		});

		const result = resolveReasoning(msg, {
			isBeingStreamed: true,
			streamReasoning: 'stream reasoning',
			streamCache: mockCache
		});

		expect(result.displayReasoning).toBe('stream reasoning');
		expect(result.shouldUpdateCache).toBe(true);
		expect(result.shouldClearCache).toBe(false);
	});

	it('falls back to persisted reasoning from parts', () => {
		const msg = createMessage({
			parts: [{ type: 'reasoning', reasoning: 'persisted from parts' }] as MessagePart[]
		});

		const result = resolveReasoning(msg, {
			isBeingStreamed: true,
			streamReasoning: undefined,
			streamCache: mockCache
		});

		expect(result.displayReasoning).toBe('persisted from parts');
		expect(result.shouldUpdateCache).toBe(true);
	});

	it('falls back to persisted reasoning from message.reasoning field', () => {
		const msg = createMessage({
			reasoning: 'legacy reasoning field'
		});

		const result = resolveReasoning(msg, {
			isBeingStreamed: true,
			streamReasoning: undefined,
			streamCache: mockCache
		});

		expect(result.displayReasoning).toBe('legacy reasoning field');
	});

	it('uses cached reasoning when stream was active but no current reasoning', () => {
		const cachedMap = new Map<number, string>([[0, 'cached reasoning']]);
		const cacheWithData = createMockStreamCache(cachedMap);

		const msg = createMessage({ order: 0 });

		const result = resolveReasoning(msg, {
			isBeingStreamed: true,
			streamReasoning: undefined,
			streamCache: cacheWithData
		});

		expect(result.displayReasoning).toBe('cached reasoning');
		expect(result.shouldUpdateCache).toBe(false); // No current reasoning to cache
	});

	it('ignores cached reasoning when message was not streamed', () => {
		const cachedMap = new Map<number, string>([[0, 'cached reasoning']]);
		const cacheWithData = createMockStreamCache(cachedMap);

		const msg = createMessage({ order: 0 });

		const result = resolveReasoning(msg, {
			isBeingStreamed: false,
			streamReasoning: undefined,
			streamCache: cacheWithData
		});

		expect(result.displayReasoning).toBe('');
		// eslint-disable-next-line @typescript-eslint/unbound-method
		expect(vi.mocked(cacheWithData.getCachedReasoning)).not.toHaveBeenCalled();
	});

	it('signals cache clear when persisted reasoning exists with cached value', () => {
		const cachedMap = new Map<number, string>([[0, 'old cached']]);
		const cacheWithData = createMockStreamCache(cachedMap);

		const msg = createMessage({
			order: 0,
			parts: [{ type: 'reasoning', reasoning: 'now persisted' }] as MessagePart[]
		});

		const result = resolveReasoning(msg, {
			isBeingStreamed: true,
			streamReasoning: undefined, // No stream, but persisted exists
			streamCache: cacheWithData
		});

		expect(result.displayReasoning).toBe('now persisted');
		expect(result.shouldClearCache).toBe(true);
	});
});

describe('transformToDisplayMessage', () => {
	let mockCache: StreamCacheManager;
	let baseContext: TransformContext;

	beforeEach(() => {
		mockCache = createMockStreamCache();
		baseContext = {
			streamingKeys: new Set<string>(),
			streamTextMap: new Map<number, string>(),
			streamReasoningMap: new Map<number, string>(),
			streamStatusMap: new Map<number, string>(),
			optimisticKeyMap: new Map<string, string>(),
			streamCache: mockCache
		};
	});

	it('handles user messages with text field', () => {
		const msg = createMessage({
			role: 'user',
			text: 'User message text'
		});

		const result = transformToDisplayMessage(msg, baseContext);

		expect(result.displayText).toBe('User message text');
		expect(result.role).toBe('user');
		expect(result.isStreaming).toBe(false);
	});

	it('handles user messages with message.content string', () => {
		const msg = createMessage({
			role: 'user',
			text: undefined,
			message: { role: 'user', content: 'Content from message' }
		});

		const result = transformToDisplayMessage(msg, baseContext);

		expect(result.displayText).toBe('Content from message');
	});

	it('handles user messages with multimodal content array', () => {
		const msg = createMessage({
			role: 'user',
			text: undefined,
			message: {
				role: 'user',
				content: [
					{ type: 'text', text: 'Part 1' },
					{ type: 'image', url: 'http://...' },
					{ type: 'text', text: 'Part 2' }
				]
			}
		});

		const result = transformToDisplayMessage(msg, baseContext);

		expect(result.displayText).toBe('Part 1 Part 2');
	});

	it('handles assistant messages without streaming', () => {
		const msg = createMessage({
			role: 'assistant',
			text: 'Assistant response'
		});

		const result = transformToDisplayMessage(msg, baseContext);

		expect(result.displayText).toBe('Assistant response');
		expect(result.isStreaming).toBe(false);
		expect(result.hasReasoningStream).toBe(false);
	});

	it('applies streaming text when message is being streamed', () => {
		const msg = createMessage({
			role: 'assistant',
			order: 5,
			stepOrder: 0,
			text: 'Incomplete...'
		});

		const context: TransformContext = {
			...baseContext,
			streamingKeys: new Set(['5-0']),
			streamTextMap: new Map([[5, 'Full streaming response']]),
			streamStatusMap: new Map([[5, 'streaming']])
		};

		const result = transformToDisplayMessage(msg, context);

		expect(result.displayText).toBe('Full streaming response');
		expect(result.isStreaming).toBe(true);
		expect(result.hasReasoningStream).toBe(true);
	});

	it('does not apply streaming data to non-streamed messages', () => {
		// streamedMsg would be at order 5, but we're testing otherMsg at order 6
		const otherMsg = createMessage({ order: 6, stepOrder: 0, text: 'Other message' });

		const context: TransformContext = {
			...baseContext,
			streamingKeys: new Set(['5-0']), // Only order 5 is streaming
			streamTextMap: new Map([[5, 'Streaming content']]),
			streamStatusMap: new Map([[5, 'streaming']])
		};

		const result = transformToDisplayMessage(otherMsg, context);

		expect(result.displayText).toBe('Other message');
		expect(result.isStreaming).toBe(false);
	});

	it('applies optimistic key mapping for render stability', () => {
		const msg = createMessage({ id: 'real-msg-123' });

		const context: TransformContext = {
			...baseContext,
			optimisticKeyMap: new Map([['real-msg-123', 'temp_optimistic-456']])
		};

		const result = transformToDisplayMessage(msg, context);

		expect(result._renderKey).toBe('temp_optimistic-456');
	});

	it('updates cache when streaming reasoning is received', () => {
		const msg = createMessage({ order: 3, stepOrder: 0 });

		const context: TransformContext = {
			...baseContext,
			streamingKeys: new Set(['3-0']),
			streamReasoningMap: new Map([[3, 'Thinking...']]),
			streamStatusMap: new Map([[3, 'streaming']])
		};

		transformToDisplayMessage(msg, context);

		// eslint-disable-next-line @typescript-eslint/unbound-method
		expect(vi.mocked(mockCache.updateReasoningCache)).toHaveBeenCalledWith(3, 'Thinking...');
	});
});

describe('transformToDisplayMessageSimple', () => {
	it('transforms user message correctly', () => {
		const msg = createMessage({
			role: 'user',
			text: 'Simple user message'
		});

		const result = transformToDisplayMessageSimple(msg, new Map());

		expect(result.displayText).toBe('Simple user message');
		expect(result.isStreaming).toBe(false);
		expect(result.hasReasoningStream).toBe(false);
	});

	it('transforms assistant message with reasoning', () => {
		const msg = createMessage({
			role: 'assistant',
			text: 'Response',
			parts: [{ type: 'reasoning', reasoning: 'My thought process' }] as MessagePart[]
		});

		const result = transformToDisplayMessageSimple(msg, new Map());

		expect(result.displayText).toBe('Response');
		expect(result.displayReasoning).toBe('My thought process');
		expect(result.hasReasoningStream).toBe(true);
	});

	it('applies optimistic key mapping', () => {
		const msg = createMessage({ id: 'real-id' });
		const keyMap = new Map([['real-id', 'optimistic-id']]);

		const result = transformToDisplayMessageSimple(msg, keyMap);

		expect(result._renderKey).toBe('optimistic-id');
	});

	it('returns empty reasoning when none exists', () => {
		const msg = createMessage({ text: 'No reasoning here' });

		const result = transformToDisplayMessageSimple(msg, new Map());

		expect(result.displayReasoning).toBe('');
		expect(result.hasReasoningStream).toBe(false);
	});
});
