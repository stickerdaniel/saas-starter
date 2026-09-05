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

	it('keeps both steps when two streams open with the same separator', () => {
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
				parts: [
					{ type: 'step-start' },
					{ type: 'reasoning', text: 'Look up the record', id: 'reason-1', state: 'done' },
					{
						type: 'tool-lookup',
						toolCallId: 'call-1',
						state: 'output-available',
						input: { id: 'record-1' },
						output: { found: true }
					}
				]
			},
			{
				id: 'stream:2',
				key: 'thread-1-1-1',
				order: 1,
				stepOrder: 1,
				status: 'success',
				agentName: 'assistant',
				text: 'answer',
				_creationTime: 2,
				role: 'assistant',
				parts: [
					{ type: 'step-start' },
					{ type: 'reasoning', text: 'Write the answer', id: 'reason-2', state: 'done' },
					{ type: 'text', text: 'answer' }
				]
			}
		] as unknown as UIMessage[];

		const combined = combineStreamingUIMessages(messages);

		expect(combined).toHaveLength(1);
		expect(
			combined[0]!.parts.map((part) => {
				const record = part as unknown as Record<string, unknown>;
				return [part.type, record.text ?? record.toolCallId ?? null];
			})
		).toEqual([
			['step-start', null],
			['reasoning', 'Look up the record'],
			['tool-lookup', 'call-1'],
			['step-start', null],
			['reasoning', 'Write the answer'],
			['text', 'answer']
		]);
	});

	// Text parts carry no id, so the words a later step opens with line up with
	// the text of the step a tool call already closed. Taking the shortcut across
	// that tool call overwrote the first step's text and moved the answer in
	// front of the call that produced it.
	it('keeps the answer behind the tool call when its words repeat the step before', () => {
		const messages: UIMessage[] = [
			{
				id: 'stream:1',
				key: 'thread-1-1-0',
				order: 1,
				stepOrder: 0,
				status: 'streaming',
				agentName: 'assistant',
				text: 'I will check',
				_creationTime: 1,
				role: 'assistant',
				parts: [
					{ type: 'step-start' },
					{ type: 'text', text: 'I will check' },
					{
						type: 'tool-lookup',
						toolCallId: 'call-1',
						state: 'output-available',
						input: {},
						output: {}
					}
				]
			},
			{
				id: 'stream:2',
				key: 'thread-1-1-1',
				order: 1,
				stepOrder: 1,
				status: 'success',
				agentName: 'assistant',
				text: 'I will check the result is ready',
				_creationTime: 2,
				role: 'assistant',
				parts: [{ type: 'step-start' }, { type: 'text', text: 'I will check the result is ready' }]
			}
		] as unknown as UIMessage[];

		const combined = combineStreamingUIMessages(messages);

		expect(combined).toHaveLength(1);
		expect(
			combined[0]!.parts.map((part) => {
				const record = part as unknown as Record<string, unknown>;
				return [part.type, record.text ?? record.toolCallId ?? null];
			})
		).toEqual([
			['step-start', null],
			['text', 'I will check'],
			['tool-lookup', 'call-1'],
			['step-start', null],
			['text', 'I will check the result is ready']
		]);
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

	// The shapes the two sides really have, and the whole reason one block used to
	// render twice. `display-message-processor` passes the persisted message
	// first, whose reasoning `@convex-dev/agent` rebuilds with no id and no
	// leading `step-start`, and the live stream second, which the AI SDK opens
	// with that `step-start` and stamps an `id` on. Nothing lines the two up, and
	// the step separator lands between them.
	it('grows a persisted reasoning block across the step separator the live stream adds', () => {
		const merged = mergeAssistantMessageParts(
			[{ type: 'reasoning', text: 'Find coordinates', state: 'done' }] as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Find coordinates', id: 'reason-1', state: 'streaming' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toEqual([
			{ type: 'reasoning', text: 'Find coordinates', state: 'streaming' }
		]);
	});

	it('keeps a second live block apart across the step separator', () => {
		const merged = mergeAssistantMessageParts(
			[{ type: 'reasoning', text: 'Analyze', state: 'done' }] as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Analyze', id: 'reason-1', state: 'done' },
				{ type: 'reasoning', text: 'Analyze alternatives', id: 'reason-2', state: 'streaming' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toEqual([
			{ type: 'reasoning', text: 'Analyze', state: 'done' },
			{ type: 'reasoning', text: 'Analyze alternatives', id: 'reason-2', state: 'streaming' }
		]);
	});

	// The row and the deltas arrive through two independent reactive queries, so
	// the live side is sometimes the older one. Taking its text would cut the
	// block back and restore it on the next frame, which reads as flicker, and a
	// finished block would start showing as still running.
	it('keeps the longer text when the live snapshot lags behind the persisted one', () => {
		const merged = mergeAssistantMessageParts(
			[{ type: 'reasoning', text: 'Find coordinates', state: 'done' }] as UIMessage['parts'],
			[
				{ type: 'reasoning', text: 'Find coord', id: 'reason-1', state: 'streaming' }
			] as unknown as UIMessage['parts']
		);

		expect(merged).toEqual([{ type: 'reasoning', text: 'Find coordinates', state: 'done' }]);
	});

	it('grows a persisted reasoning block that the live stream carries an id for', () => {
		const merged = mergeAssistantMessageParts(
			[{ type: 'reasoning', text: 'Find coord' }] as UIMessage['parts'],
			[
				{ type: 'reasoning', text: 'Find coordinates', streamPartId: 'reason-1' }
			] as unknown as UIMessage['parts']
		);

		expect(merged).toEqual([{ type: 'reasoning', text: 'Find coordinates' }]);
	});

	it('grows a reasoning block whose snapshot dropped the streaming id', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Find coord', streamPartId: 'reason-1' }
			] as unknown as UIMessage['parts'],
			[{ type: 'reasoning', text: 'Find coordinates' }] as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'reasoning', text: 'Find coordinates', streamPartId: 'reason-1' }
		]);
	});

	it('keeps two reasoning blocks apart when only one carries a streaming id', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Find coordinates', streamPartId: 'reason-1' }
			] as unknown as UIMessage['parts'],
			[{ type: 'reasoning', text: 'Check forecast' }] as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'reasoning', text: 'Find coordinates', streamPartId: 'reason-1' },
			{ type: 'reasoning', text: 'Check forecast' }
		]);
	});

	// Text growth is the only evidence available once the ids fail to line up, and
	// two adjacent blocks can both grow out of the same opening words. The block a
	// snapshot already claimed is off limits to the next one, so an overlap costs
	// a missed merge and never a lost block.
	it('does not fold two overlapping blocks into the one they both extend', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Analyze', streamPartId: 'reason-1' }
			] as unknown as UIMessage['parts'],
			[
				{ type: 'reasoning', text: 'Analyze' },
				{ type: 'reasoning', text: 'Analyze alternatives' }
			] as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'reasoning', text: 'Analyze', streamPartId: 'reason-1' },
			{ type: 'reasoning', text: 'Analyze alternatives' }
		]);
	});

	it('keeps a finished reasoning block when a later step opens an empty one', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Check weather forecast' },
				{
					type: 'tool-getWeather',
					toolCallId: 'tool-2',
					state: 'output-available',
					output: { temperature: 62.6 }
				}
			] as unknown as UIMessage['parts'],
			[{ type: 'reasoning', text: '', streamPartId: 'reason-2' }] as unknown as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'reasoning', text: 'Check weather forecast' },
			{
				type: 'tool-getWeather',
				toolCallId: 'tool-2',
				state: 'output-available',
				output: { temperature: 62.6 }
			},
			{ type: 'reasoning', text: '', streamPartId: 'reason-2' }
		]);
	});

	it('does not let an empty reasoning snapshot erase the block it follows', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'tool-getWeather', toolCallId: 'tool-2', state: 'output-available' },
				{ type: 'reasoning', text: 'Draft final answer' }
			] as unknown as UIMessage['parts'],
			[{ type: 'reasoning', text: '' }] as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'tool-getWeather', toolCallId: 'tool-2', state: 'output-available' },
			{ type: 'reasoning', text: 'Draft final answer' },
			{ type: 'reasoning', text: '' }
		]);
	});

	// A signature-only reasoning detail reaches the provider as a block with an
	// empty delta, and the persisted row keeps that empty block. Rejecting every
	// empty incoming block left the live copy with nothing to merge into, so the
	// one block rendered as two rows for as long as the stream was open.
	it('matches an empty reasoning block to its empty copy', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: '', state: 'done' },
				{ type: 'step-start' },
				{
					type: 'tool-lookup',
					toolCallId: 'call-1',
					state: 'output-available',
					input: {},
					output: {}
				}
			] as unknown as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: '', id: 'r1', state: 'done' },
				{
					type: 'tool-lookup',
					toolCallId: 'call-1',
					state: 'output-available',
					input: {},
					output: {}
				},
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Next thought', id: 'r2', state: 'streaming' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toEqual([
			{ type: 'reasoning', text: '', state: 'done' },
			{ type: 'reasoning', text: 'Next thought', id: 'r2', state: 'streaming' }
		]);
		expect(merged.filter((part) => part.type === 'tool-lookup')).toHaveLength(1);
	});

	it('merges a grown reasoning block that follows a completed tool call', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'tool-getWeather', toolCallId: 'tool-2', state: 'output-available' },
				{ type: 'reasoning', text: 'Draft final' }
			] as unknown as UIMessage['parts'],
			[{ type: 'reasoning', text: 'Draft final answer' }] as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'tool-getWeather', toolCallId: 'tool-2', state: 'output-available' },
			{ type: 'reasoning', text: 'Draft final answer' }
		]);
	});

	// A tool call closes the step its reasoning belongs to, so a fresh tail block
	// whose opening words repeat that reasoning is a later step and not a
	// continuation. Merging it backward would delete the earlier block and move
	// the new one in front of the tool call that ran between them.
	it('opens a new block when the words repeat one a tool call already closed', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Analyze' },
				{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' }
			] as unknown as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Analyze alternatives', id: 'reason-2' }
			] as unknown as UIMessage['parts']
		);

		expect(merged).toEqual([
			{ type: 'reasoning', text: 'Analyze' },
			{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' },
			{ type: 'step-start' },
			{ type: 'reasoning', text: 'Analyze alternatives', id: 'reason-2' }
		]);
	});

	// The same closed block is still the right target when the live snapshot
	// carries the whole message, because there the tool call sits behind the
	// incoming part too.
	it('still grows a closed block when the snapshot repeats the tool call', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Analyze' },
				{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' }
			] as unknown as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Analyze the options', id: 'reason-1' },
				{ type: 'tool-getGeocoding', toolCallId: 'tool-1', state: 'output-available' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toEqual([
			{ type: 'reasoning', text: 'Analyze the options' }
		]);
	});

	// The page and the delta snapshot arrive through two queries, so the page can
	// be one tool chunk ahead of the snapshot. The lagging copy is a prefix of the
	// closed block and has to grow it; the sentence used to render a second time on
	// the other side of the tool card until the next delta arrived.
	it('grows a closed block from the snapshot that lags behind its tool call', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'step-start' },
				{ type: 'text', text: 'I will check' },
				{
					type: 'tool-lookup',
					toolCallId: 'call-1',
					state: 'output-available',
					input: {},
					output: {}
				}
			] as unknown as UIMessage['parts'],
			[{ type: 'step-start' }, { type: 'text', text: 'I will' }] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'text')).toEqual([
			{ type: 'text', text: 'I will check' }
		]);
		expect(merged.filter((part) => part.type === 'tool-lookup')).toHaveLength(1);
	});

	// The same lag on a reasoning block, where the shorter copy also carries the
	// live id and the streaming state. The longer text and its finished state win,
	// and the persisted block keeps its own key.
	it('keeps a lagging reasoning snapshot inside its closed block', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Find coordinates', state: 'done' },
				{ type: 'step-start' },
				{
					type: 'tool-lookup',
					toolCallId: 'call-1',
					state: 'output-available',
					input: {},
					output: {}
				}
			] as unknown as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Find coord', id: 'r1', state: 'streaming' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toEqual([
			{ type: 'reasoning', text: 'Find coordinates', state: 'done' }
		]);
		expect(merged.filter((part) => part.type === 'tool-lookup')).toHaveLength(1);
	});

	// The id belongs to the live snapshot alone, and the persisted reconstruction
	// carries no counterpart for it. A persisted block holding a borrowed id would
	// read as a live part to any consumer that matches on `id` or `streamPartId`.
	it('leaves a persisted block without the id of the snapshot it merged', () => {
		const merged = mergeAssistantMessageParts(
			[{ type: 'reasoning', text: 'Second block' }] as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Second block continues', id: 'reason-live' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toEqual([
			{ type: 'reasoning', text: 'Second block continues' }
		]);
	});

	// Both sides list their blocks in the order the model wrote them, so the
	// second block belongs to the second incoming part. Weighing the candidates
	// by length handed it to the first one, which left the second with nothing to
	// merge into and appended a copy of the block and of the answer with it.
	it('matches two blocks that share their opening words in order', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Analyze' },
				{ type: 'step-start' },
				{ type: 'tool-lookup', toolCallId: 'call-1', state: 'output-available' },
				{ type: 'reasoning', text: 'Analyze alternatives' },
				{ type: 'text', text: 'the answer' }
			] as unknown as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Analyze', id: 'r-first' },
				{ type: 'tool-lookup', toolCallId: 'call-1', state: 'output-available' },
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Analyze alternatives', id: 'r-second' },
				{ type: 'text', text: 'the answer' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toEqual([
			{ type: 'reasoning', text: 'Analyze' },
			{ type: 'reasoning', text: 'Analyze alternatives' }
		]);
		expect(merged.filter((part) => part.type === 'text')).toHaveLength(1);
	});

	// Two blocks of one step, where the first one's words open the second. The
	// cursor keeps each incoming block behind the one its predecessor matched, so
	// neither block can be overwritten by the words of the other.
	it('keeps two blocks of one step apart when the words overlap', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'Analyze' },
				{ type: 'reasoning', text: 'Analyze more' },
				{ type: 'text', text: 'answer' }
			] as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'Analyze', id: 'r1' },
				{ type: 'reasoning', text: 'Analyze more', id: 'r2' },
				{ type: 'text', text: 'answer' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toEqual([
			{ type: 'reasoning', text: 'Analyze' },
			{ type: 'reasoning', text: 'Analyze more' }
		]);
		expect(merged.filter((part) => part.type === 'text')).toEqual([
			{ type: 'text', text: 'answer' }
		]);
	});

	// The separator the live stream opens its step with lands on the tail, which
	// leaves the persisted answer one position further up. Merging text into the
	// last part alone missed it there and rendered the answer a second time.
	it('merges the answer across the separator pushed behind it', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'reasoning', text: 'think' },
				{ type: 'text', text: 'answer' }
			] as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', text: 'think', id: 'r1' },
				{ type: 'text', text: 'answer' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'text')).toEqual([
			{ type: 'text', text: 'answer' }
		]);
	});

	// The message list materializes an active stream into its own page, so the
	// existing side is a second live view that can be the newer one. `reasoning-end`
	// closes a block without adding to its text (measured), so both sides read
	// identically and only the state says the block finished.
	it('keeps a closed live block closed when the other live view lags', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'step-start' },
				{ type: 'reasoning', id: 'r1', text: 'complete thought', state: 'done' }
			] as unknown as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', id: 'r1', text: 'complete thought', state: 'streaming' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toMatchObject([
			{ text: 'complete thought', state: 'done' }
		]);
	});

	// The persisted reconstruction stamps `done` on every block it rebuilds, even
	// one whose step is still running, and carries no id. Its state says nothing,
	// so the live side still decides.
	it('lets the live side reopen a block the persisted copy only calls done', () => {
		const merged = mergeAssistantMessageParts(
			[{ type: 'reasoning', text: 'Find coordinates', state: 'done' }] as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'reasoning', id: 'r1', text: 'Find coordinates', state: 'streaming' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type === 'reasoning')).toMatchObject([
			{ text: 'Find coordinates', state: 'streaming' }
		]);
	});

	// A tool call runs once, so the side holding its result is the newer one. Taking
	// the incoming state left a spinner sitting above a finished result.
	it('keeps a settled tool call settled when the other side lags', () => {
		const merged = mergeAssistantMessageParts(
			[
				{ type: 'step-start' },
				{
					type: 'tool-lookup',
					toolCallId: 'call-1',
					state: 'output-available',
					input: { id: 'record-1' },
					output: { found: true }
				}
			] as unknown as UIMessage['parts'],
			[
				{ type: 'step-start' },
				{ type: 'tool-lookup', toolCallId: 'call-1', state: 'input-streaming' }
			] as unknown as UIMessage['parts']
		);

		expect(merged.filter((part) => part.type.startsWith('tool-'))).toMatchObject([
			{ state: 'output-available', output: { found: true } }
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
