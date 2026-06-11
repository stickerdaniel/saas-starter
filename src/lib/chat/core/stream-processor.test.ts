/**
 * Unit tests for StreamProcessor
 */

import { describe, it, expect } from 'vitest';
import {
	blankUIMessage,
	combineStreamingUIMessages,
	deriveUIMessagesFromDeltas,
	deriveUIMessagesFromTextStreamParts,
	mergeAssistantMessageParts,
	statusFromStreamStatus
} from './stream-materialization.js';
import { extractReasoning, extractUserMessageText } from './message-extraction.js';
import type { MessagePart, ChatMessage } from './types.js';
import type { UIMessage } from '@convex-dev/agent';
import type { StreamMessage } from '@convex-dev/agent/validators';

// Minimal StreamMessage factory matching @convex-dev/agent shape
function createStreamMessage(
	overrides: Partial<{
		streamId: string;
		status: 'streaming' | 'finished' | 'aborted';
		format: 'UIMessageChunk' | 'TextStreamPart';
		order: number;
		stepOrder: number;
		agentName: string | undefined;
	}> = {}
) {
	return {
		streamId: 'stream-1',
		status: 'streaming' as const,
		order: 0,
		stepOrder: 0,
		agentName: undefined,
		...overrides
	};
}

// Factory for ChatMessage used in extractUserMessageText tests
function createChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: 'msg-1',
		_creationTime: Date.now(),
		role: 'user',
		status: 'success',
		order: 0,
		...overrides
	};
}

// ─── blankUIMessage ───────────────────────────────────────────────────────────

describe('blankUIMessage', () => {
	it('returns a UIMessage with correct id derived from streamId', () => {
		const streamMsg = createStreamMessage({ streamId: 'abc-123' });
		const result = blankUIMessage(streamMsg, 'thread-1');
		expect(result.id).toBe('stream:abc-123');
	});

	it('constructs key from threadId, order, and stepOrder', () => {
		const streamMsg = createStreamMessage({ order: 3, stepOrder: 2 });
		const result = blankUIMessage(streamMsg, 'thread-42');
		expect(result.key).toBe('thread-42-3-2');
	});

	it('sets role to assistant', () => {
		const result = blankUIMessage(createStreamMessage(), 'thread-1');
		expect(result.role).toBe('assistant');
	});

	it('sets text to empty string', () => {
		const result = blankUIMessage(createStreamMessage(), 'thread-1');
		expect(result.text).toBe('');
	});

	it('sets parts to empty array', () => {
		const result = blankUIMessage(createStreamMessage(), 'thread-1');
		expect(result.parts).toEqual([]);
	});

	it('maps streaming status correctly via statusFromStreamStatus', () => {
		const streamMsg = createStreamMessage({ status: 'streaming' });
		const result = blankUIMessage(streamMsg, 'thread-1');
		expect(result.status).toBe('streaming');
	});

	it('maps finished status to success', () => {
		const streamMsg = createStreamMessage({ status: 'finished' });
		const result = blankUIMessage(streamMsg, 'thread-1');
		expect(result.status).toBe('success');
	});

	it('carries over agentName', () => {
		const streamMsg = createStreamMessage({ agentName: 'support-bot' });
		const result = blankUIMessage(streamMsg, 'thread-1');
		expect(result.agentName).toBe('support-bot');
	});

	it('includes metadata when present on streamMessage', () => {
		const streamMsg = { ...createStreamMessage(), metadata: { customKey: 'value' } };
		const result = blankUIMessage(streamMsg, 'thread-1');
		expect((result as typeof result & { metadata: unknown }).metadata).toEqual({
			customKey: 'value'
		});
	});

	it('omits metadata key when not present on streamMessage', () => {
		const streamMsg = createStreamMessage();
		const result = blankUIMessage(streamMsg, 'thread-1');
		expect('metadata' in result).toBe(false);
	});
});

// ─── statusFromStreamStatus ───────────────────────────────────────────────────

describe('statusFromStreamStatus', () => {
	it('maps "streaming" to "streaming"', () => {
		expect(statusFromStreamStatus('streaming')).toBe('streaming');
	});

	it('maps "finished" to "success"', () => {
		expect(statusFromStreamStatus('finished')).toBe('success');
	});

	it('maps "aborted" to "failed"', () => {
		expect(statusFromStreamStatus('aborted')).toBe('failed');
	});

	it('maps unknown/undefined status to "pending"', () => {
		// Cast to any to simulate an unexpected value arriving at runtime
		expect(statusFromStreamStatus(undefined as any)).toBe('pending');
	});

	it('maps an unrecognised string to "pending"', () => {
		expect(statusFromStreamStatus('unknown' as any)).toBe('pending');
	});
});

// ─── extractReasoning ─────────────────────────────────────────────────────────

describe('extractReasoning', () => {
	it('returns empty string when parts is undefined', () => {
		expect(extractReasoning(undefined)).toBe('');
	});

	it('returns empty string for empty parts array', () => {
		expect(extractReasoning([])).toBe('');
	});

	it('extracts text from a single reasoning part', () => {
		const parts: MessagePart[] = [{ type: 'reasoning', text: 'My thought process' }];
		expect(extractReasoning(parts)).toBe('My thought process');
	});

	it('concatenates text from multiple reasoning parts', () => {
		const parts: MessagePart[] = [
			{ type: 'reasoning', text: 'First thought' },
			{ type: 'reasoning', text: 'Second thought' }
		];
		expect(extractReasoning(parts)).toBe('First thoughtSecond thought');
	});

	it('ignores non-reasoning parts', () => {
		const parts: MessagePart[] = [
			{ type: 'text', text: 'Visible response' },
			{ type: 'reasoning', text: 'Hidden reasoning' }
		];
		expect(extractReasoning(parts)).toBe('Hidden reasoning');
	});

	it('returns empty string when no reasoning parts exist', () => {
		const parts: MessagePart[] = [
			{ type: 'text', text: 'Only text' },
			{ type: 'tool-call', toolCallId: 'id-1' }
		];
		expect(extractReasoning(parts)).toBe('');
	});

	it('ignores reasoning parts with missing text', () => {
		const parts: MessagePart[] = [{ type: 'reasoning' }];
		expect(extractReasoning(parts)).toBe('');
	});

	it('ignores reasoning parts with non-string text', () => {
		const parts: MessagePart[] = [
			{ type: 'reasoning', text: 42 as unknown as string },
			{ type: 'reasoning', text: { value: 'nope' } as unknown as string }
		];
		expect(extractReasoning(parts)).toBe('');
	});

	it('ignores malformed reasoning parts mixed with tool parts', () => {
		const parts: MessagePart[] = [
			{ type: 'reasoning' },
			{ type: 'tool-requestUserEmail', toolCallId: 'tool-1', state: 'input-available' },
			{ type: 'reasoning', text: 'Real reasoning' }
		];
		expect(extractReasoning(parts)).toBe('Real reasoning');
	});
});

describe('deriveUIMessagesFromTextStreamParts', () => {
	it('appends repeated reasoning delta ids into one logical reasoning part (TextStreamPart format)', () => {
		const [messages] = deriveUIMessagesFromTextStreamParts(
			'thread-1',
			[createStreamMessage({ streamId: 'stream-1', order: 1, stepOrder: 0 })],
			[],
			[
				{
					streamId: 'stream-1',
					start: 0,
					end: 1,
					parts: [{ type: 'reasoning-start', id: 'reason-1' }]
				},
				{
					streamId: 'stream-1',
					start: 1,
					end: 2,
					parts: [{ type: 'reasoning-delta', id: 'reason-1', text: 'First ' }]
				},
				{
					streamId: 'stream-1',
					start: 2,
					end: 3,
					parts: [{ type: 'reasoning-delta', id: 'reason-1', text: 'second' }]
				}
			] as any
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]!.parts?.filter((part) => part.type === 'reasoning')).toHaveLength(1);
		expect(extractReasoning(messages[0]!.parts as MessagePart[])).toBe('First second');
	});

	it('handles UIMessageChunk format where text content is in delta field', () => {
		const [messages] = deriveUIMessagesFromTextStreamParts(
			'thread-1',
			[createStreamMessage({ streamId: 'stream-1', order: 1, stepOrder: 0 })],
			[],
			[
				{
					streamId: 'stream-1',
					start: 0,
					end: 1,
					parts: [{ type: 'text-start', id: 'text-1' }]
				},
				{
					streamId: 'stream-1',
					start: 1,
					end: 2,
					parts: [{ type: 'text-delta', id: 'text-1', delta: 'Hello ' }]
				},
				{
					streamId: 'stream-1',
					start: 2,
					end: 3,
					parts: [{ type: 'text-delta', id: 'text-1', delta: 'world' }]
				}
			] as any
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]!.text).toBe('Hello world');
	});

	it('handles UIMessageChunk format for reasoning deltas (delta field)', () => {
		const [messages] = deriveUIMessagesFromTextStreamParts(
			'thread-1',
			[createStreamMessage({ streamId: 'stream-1', order: 1, stepOrder: 0 })],
			[],
			[
				{
					streamId: 'stream-1',
					start: 0,
					end: 1,
					parts: [{ type: 'reasoning-start', id: 'reason-1' }]
				},
				{
					streamId: 'stream-1',
					start: 1,
					end: 2,
					parts: [{ type: 'reasoning-delta', id: 'reason-1', delta: 'Thinking ' }]
				},
				{
					streamId: 'stream-1',
					start: 2,
					end: 3,
					parts: [{ type: 'reasoning-delta', id: 'reason-1', delta: 'about it' }]
				}
			] as any
		);

		expect(messages).toHaveLength(1);
		expect(extractReasoning(messages[0]!.parts as MessagePart[])).toBe('Thinking about it');
	});

	it('does NOT produce "undefined" strings when delta parts lack a text field', () => {
		// This is the exact bug scenario: UIMessageChunk format parts have `delta`
		// field but no `text` field. Without the fix, part.text would be undefined
		// and string concatenation would produce literal "undefined" strings.
		const [messages] = deriveUIMessagesFromTextStreamParts(
			'thread-1',
			[createStreamMessage({ streamId: 'stream-1', order: 1, stepOrder: 0 })],
			[],
			[
				{
					streamId: 'stream-1',
					start: 0,
					end: 1,
					parts: [{ type: 'text-start', id: 'text-1' }]
				},
				{
					streamId: 'stream-1',
					start: 1,
					end: 2,
					// Simulates UIMessageChunk: has `delta` but no `text`
					parts: [{ type: 'text-delta', id: 'text-1', delta: 'Hi' }]
				},
				{
					streamId: 'stream-1',
					start: 2,
					end: 3,
					parts: [{ type: 'text-delta', id: 'text-1', delta: ' there' }]
				}
			] as any
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]!.text).toBe('Hi there');
		expect(messages[0]!.text).not.toContain('undefined');
	});
});

describe('deriveUIMessagesFromDeltas', () => {
	it('materializes UIMessageChunk tool parts to output-available', async () => {
		const messages = await deriveUIMessagesFromDeltas(
			'thread-1',
			[
				createStreamMessage({
					streamId: 'stream-1',
					order: 1,
					stepOrder: 0,
					status: 'streaming',
					format: 'UIMessageChunk' as const
				}) as StreamMessage
			],
			[
				{
					streamId: 'stream-1',
					start: 0,
					end: 1,
					parts: [{ type: 'start' }]
				},
				{
					streamId: 'stream-1',
					start: 1,
					end: 2,
					parts: [{ type: 'start-step' }]
				},
				{
					streamId: 'stream-1',
					start: 2,
					end: 3,
					parts: [{ type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'getWeather' }]
				},
				{
					streamId: 'stream-1',
					start: 3,
					end: 4,
					parts: [
						{
							type: 'tool-input-available',
							toolCallId: 'tool-1',
							toolName: 'getWeather',
							input: { latitude: 35.68, longitude: 139.69 }
						}
					]
				},
				{
					streamId: 'stream-1',
					start: 4,
					end: 5,
					parts: [
						{
							type: 'tool-output-available',
							toolCallId: 'tool-1',
							output: { temperature: 10.1, unit: 'C' }
						}
					]
				}
			] as any
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]!.parts).toContainEqual(
			expect.objectContaining({
				type: 'tool-getWeather',
				toolCallId: 'tool-1',
				state: 'output-available',
				input: { latitude: 35.68, longitude: 139.69 },
				output: { temperature: 10.1, unit: 'C' }
			})
		);
	});
});

describe('combineStreamingUIMessages', () => {
	it('combines assistant stream steps by order so later steps override the grouped UI message', () => {
		const messages: UIMessage[] = [
			{
				id: 'stream:1',
				key: 'thread-1-1-0',
				order: 1,
				stepOrder: 0,
				status: 'streaming',
				agentName: 'assistant',
				text: '',
				_creationTime: 1,
				role: 'assistant',
				parts: [{ type: 'reasoning', text: 'Finding coordinates', state: 'done' }]
			},
			{
				id: 'stream:2',
				key: 'thread-1-1-1',
				order: 1,
				stepOrder: 1,
				status: 'streaming',
				agentName: 'assistant',
				text: '',
				_creationTime: 2,
				role: 'assistant',
				parts: [
					{
						type: 'tool-getGeocoding',
						toolCallId: 'tool-1',
						state: 'output-available',
						input: { location: 'Tokyo' },
						output: { latitude: 35.68, longitude: 139.69 }
					}
				]
			},
			{
				id: 'stream:3',
				key: 'thread-1-1-2',
				order: 1,
				stepOrder: 2,
				status: 'success',
				agentName: 'assistant',
				text: 'It is 10.1C.',
				_creationTime: 3,
				role: 'assistant',
				parts: [{ type: 'text', text: 'It is 10.1C.' }]
			}
		];

		const combined = combineStreamingUIMessages(messages);

		expect(combined).toHaveLength(1);
		expect(combined[0]!.stepOrder).toBe(0);
		expect(combined[0]!.status).toBe('success');
		expect(combined[0]!.parts.map((part) => part.type)).toEqual([
			'reasoning',
			'tool-getGeocoding',
			'text'
		]);
		expect(combined[0]!.text).toBe('It is 10.1C.');
	});
});

describe('mergeAssistantMessageParts', () => {
	it('treats a grouped streamed prefix as authoritative instead of appending duplicate reasoning blocks', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Find coordinates' },
				{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' }
			] as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Find coordinates' },
				{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' },
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Check forecast' }
			] as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'step-start' },
			{ type: 'reasoning', text: 'Find coordinates' },
			{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' },
			{ type: 'step-start' },
			{ type: 'reasoning', text: 'Check forecast' }
		]);
	});

	it('keeps the persisted prefix when the live stream only exposes a new tail step', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Find coordinates', streamPartId: 'reason-1' },
				{
					type: 'tool-getGeocoding',
					toolCallId: 'tool-1',
					state: 'output-available',
					input: { location: 'Tokyo' },
					output: { latitude: 35.68, longitude: 139.69 }
				},
				{ type: 'reasoning', text: 'Check forecast', streamPartId: 'reason-2' },
				{
					type: 'tool-getWeather',
					toolCallId: 'tool-2',
					state: 'output-available',
					input: { latitude: 35.68, longitude: 139.69 },
					output: { temperature: 62.6 }
				}
			] as UIMessage['parts'],
			[{ type: 'reasoning', text: 'Draft final answer' }] as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'reasoning', text: 'Find coordinates', streamPartId: 'reason-1' },
			{
				type: 'tool-getGeocoding',
				toolCallId: 'tool-1',
				state: 'output-available',
				input: { location: 'Tokyo' },
				output: { latitude: 35.68, longitude: 139.69 }
			},
			{ type: 'reasoning', text: 'Check forecast', streamPartId: 'reason-2' },
			{
				type: 'tool-getWeather',
				toolCallId: 'tool-2',
				state: 'output-available',
				input: { latitude: 35.68, longitude: 139.69 },
				output: { temperature: 62.6 }
			},
			{ type: 'reasoning', text: 'Draft final answer' }
		]);
	});
});

// ─── extractUserMessageText ───────────────────────────────────────────────────

describe('extractUserMessageText', () => {
	it('prefers msg.text when it is a non-empty string', () => {
		const msg = createChatMessage({ text: 'Direct text field' });
		expect(extractUserMessageText(msg)).toBe('Direct text field');
	});

	it('falls back to message.content when msg.text is absent', () => {
		const msg = createChatMessage({
			text: undefined,
			message: { role: 'user', content: 'Content string' }
		});
		expect(extractUserMessageText(msg)).toBe('Content string');
	});

	it('handles array content with text-type parts', () => {
		const msg = createChatMessage({
			text: undefined,
			message: {
				role: 'user',
				content: [
					{ type: 'text', text: 'Hello' },
					{ type: 'text', text: 'World' }
				]
			}
		});
		expect(extractUserMessageText(msg)).toBe('Hello World');
	});

	it('handles multimodal array content — only extracts text parts', () => {
		const msg = createChatMessage({
			text: undefined,
			message: {
				role: 'user',
				content: [
					{ type: 'text', text: 'Describe this image' },
					{ type: 'image', url: 'https://example.com/img.png' }
				]
			}
		});
		expect(extractUserMessageText(msg)).toBe('Describe this image');
	});

	it('handles array of plain strings', () => {
		const msg = createChatMessage({
			text: undefined,
			message: { role: 'user', content: ['part one', 'part two'] }
		});
		expect(extractUserMessageText(msg)).toBe('part one part two');
	});

	it('handles object content with a text field', () => {
		const msg = createChatMessage({
			text: undefined,
			message: { role: 'user', content: { text: 'Object text' } }
		});
		expect(extractUserMessageText(msg)).toBe('Object text');
	});

	it('returns empty string when msg has no text and no message', () => {
		const msg = createChatMessage({ text: undefined, message: undefined });
		expect(extractUserMessageText(msg)).toBe('');
	});

	it('returns empty string when message.content is null', () => {
		const msg = createChatMessage({
			text: undefined,
			message: { role: 'user', content: null }
		});
		expect(extractUserMessageText(msg)).toBe('');
	});

	it('does not use msg.text when it is an empty string', () => {
		const msg = createChatMessage({
			text: '',
			message: { role: 'user', content: 'Fallback content' }
		});
		// Empty string is falsy, so it falls through to message.content
		expect(extractUserMessageText(msg)).toBe('Fallback content');
	});
});
