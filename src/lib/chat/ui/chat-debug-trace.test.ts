import { describe, expect, it } from 'vitest';
import {
	getLatestTraceEvents,
	summarizeAccordionState,
	summarizeChatMessage
} from './chat-debug-trace.svelte.js';
import type { DisplayMessage } from '../core/types.js';

function createDisplayMessage(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
	return {
		id: 'msg-1',
		_creationTime: 1,
		role: 'assistant',
		status: 'streaming',
		order: 1,
		text: '',
		displayText: '',
		displayReasoning: '',
		isStreaming: true,
		hasReasoningStream: true,
		parts: [],
		...overrides
	};
}

describe('getLatestTraceEvents', () => {
	it('keeps only the latest event per stage and scope', () => {
		const latest = getLatestTraceEvents([
			{
				seq: 1,
				ts: 1,
				stage: 'messages-query',
				scope: 'root',
				threadId: 'thread-1',
				payload: { count: 1 }
			},
			{
				seq: 2,
				ts: 2,
				stage: 'messages-query',
				scope: 'root',
				threadId: 'thread-1',
				payload: { count: 2 }
			},
			{
				seq: 3,
				ts: 3,
				stage: 'accordion-after',
				scope: 'root',
				threadId: 'thread-1',
				payload: { openKeys: [] }
			}
		]);

		expect(latest).toHaveLength(2);
		expect(latest[0]?.seq).toBe(3);
		expect(latest[1]?.seq).toBe(2);
	});
});

describe('summarizeChatMessage', () => {
	it('returns compact part summaries', () => {
		const summary = summarizeChatMessage(
			createDisplayMessage({
				text: 'Done',
				displayText: 'Done',
				displayReasoning: 'Thinking',
				parts: [
					{ type: 'reasoning', text: 'Thinking', streamPartId: 'reason-1', state: 'streaming' },
					{ type: 'tool-getWeather', toolCallId: 'tool-1', state: 'output-available' },
					{ type: 'text', text: 'Done' }
				]
			})
		);

		expect(summary.parts).toEqual([
			{
				kind: 'reasoning',
				key: 'reasoning-reason-1',
				textLength: 8,
				state: 'streaming'
			},
			{
				kind: 'tool',
				key: 'tool-1',
				type: 'tool-getWeather',
				state: 'output-available'
			},
			{
				kind: 'text',
				key: 'text-2',
				textLength: 4
			}
		]);
	});
});

describe('summarizeAccordionState', () => {
	it('reports open and active reasoning keys', () => {
		const message = createDisplayMessage({
			parts: [
				{ type: 'reasoning', text: 'First', streamPartId: 'reason-1' },
				{ type: 'tool-getWeather', toolCallId: 'tool-1', state: 'output-available' },
				{ type: 'reasoning', text: 'Second', streamPartId: 'reason-2' }
			]
		});

		const summary = summarizeAccordionState([message], {
			reasoningOpenState: new Map([['msg-1:reasoning-reason-2', true]]),
			autoOpenedMessages: new Set(['msg-1:reasoning-reason-2'])
		} as unknown as Parameters<typeof summarizeAccordionState>[1]);

		expect(summary.openKeys).toEqual(['msg-1:reasoning-reason-2']);
		expect(summary.autoOpenedKeys).toEqual(['msg-1:reasoning-reason-2']);
		expect(summary.messages).toEqual([
			{
				id: 'msg-1',
				order: 1,
				status: 'streaming',
				activeReasoningKey: 'msg-1:reasoning-reason-2',
				reasoningKeys: ['msg-1:reasoning-reason-1', 'msg-1:reasoning-reason-2']
			}
		]);
	});
});
