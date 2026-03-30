/**
 * Unit tests for DisplayMessageProcessor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	resolveReasoning,
	dedupeDisplayMessagesForRender,
	transformToDisplayMessage,
	type TransformContext
} from './DisplayMessageProcessor.js';
import type { ChatMessage, MessagePart } from './types.js';
import type { StreamCacheManager } from './stream-cache.js';

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
			parts: [{ type: 'reasoning', text: 'persisted reasoning' }] as MessagePart[]
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
			parts: [{ type: 'reasoning', text: 'persisted from parts' }] as MessagePart[]
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
		expect(cacheWithData.getCachedReasoning).not.toHaveBeenCalled();
	});

	it('signals cache clear when persisted reasoning exists with cached value', () => {
		const cachedMap = new Map<number, string>([[0, 'old cached']]);
		const cacheWithData = createMockStreamCache(cachedMap);

		const msg = createMessage({
			order: 0,
			parts: [{ type: 'reasoning', text: 'now persisted' }] as MessagePart[]
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
			streamMessageMap: new Map(),
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
			streamMessageMap: new Map([
				[
					5,
					{
						id: 'stream:5',
						key: 'thread-1-5-0',
						order: 5,
						stepOrder: 0,
						agentName: 'assistant',
						text: 'Full streaming response',
						_creationTime: 1,
						role: 'assistant',
						status: 'streaming',
						parts: [{ type: 'text', text: 'Full streaming response' }]
					}
				]
			])
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
			streamMessageMap: new Map([
				[
					5,
					{
						id: 'stream:5',
						key: 'thread-1-5-0',
						order: 5,
						stepOrder: 0,
						agentName: 'assistant',
						text: 'Streaming content',
						_creationTime: 1,
						role: 'assistant',
						status: 'streaming',
						parts: [{ type: 'text', text: 'Streaming content' }]
					}
				]
			])
		};

		const result = transformToDisplayMessage(otherMsg, context);

		expect(result.displayText).toBe('Other message');
		expect(result.isStreaming).toBe(false);
	});

	it('updates cache when streaming reasoning is received', () => {
		const msg = createMessage({ order: 3, stepOrder: 0 });

		const context: TransformContext = {
			...baseContext,
			streamMessageMap: new Map([
				[
					3,
					{
						id: 'stream:3',
						key: 'thread-1-3-0',
						order: 3,
						stepOrder: 0,
						agentName: 'assistant',
						text: '',
						_creationTime: 1,
						role: 'assistant',
						status: 'streaming',
						parts: [{ type: 'reasoning', text: 'Thinking...' }]
					}
				]
			])
		};

		transformToDisplayMessage(msg, context);

		expect(mockCache.updateReasoningCache).toHaveBeenCalledWith(3, 'Thinking...');
	});

	it('returns empty displayReasoning for malformed reasoning parts', () => {
		const msg = createMessage({
			text: 'Assistant response',
			parts: [{ type: 'reasoning' }] as MessagePart[]
		});

		const result = transformToDisplayMessage(msg, baseContext);

		expect(result.displayReasoning).toBe('');
	});
});

describe('dedupeDisplayMessagesForRender', () => {
	it('keeps the last occurrence of duplicate message ids while preserving order', () => {
		const context: TransformContext = {
			streamMessageMap: new Map(),
			streamCache: createMockStreamCache()
		};
		const messages = [
			transformToDisplayMessage(createMessage({ id: 'msg-1', text: 'first' }), context),
			transformToDisplayMessage(createMessage({ id: 'msg-2', text: 'middle' }), context),
			transformToDisplayMessage(createMessage({ id: 'msg-1', text: 'last' }), context)
		];

		expect(dedupeDisplayMessagesForRender(messages)).toMatchObject([
			{ id: 'msg-2', displayText: 'middle' },
			{ id: 'msg-1', displayText: 'last' }
		]);
	});
});
