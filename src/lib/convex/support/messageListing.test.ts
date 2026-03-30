import { describe, expect, it } from 'vitest';
import type { UIMessage } from '@convex-dev/agent';
import type { ChatMessage } from '../../chat/core/types';
import { mergeAssistantMessage, mergeMaterializedStreamsIntoPage } from './messageListing';

describe('mergeAssistantMessage', () => {
	it('replaces persisted assistant text and parts with materialized stream content', () => {
		const persisted: ChatMessage = {
			id: 'msg-1',
			_creationTime: 1,
			role: 'assistant',
			status: 'success',
			order: 2,
			stepOrder: 0,
			text: 'Persisted text',
			parts: [{ type: 'text', text: 'Persisted text' }],
			metadata: { provider: 'openai' }
		};

		const materialized: UIMessage = {
			id: 'stream:abc',
			key: 'thread-2-0',
			_creationTime: 2,
			role: 'assistant',
			status: 'success',
			order: 2,
			stepOrder: 0,
			text: 'Final answer',
			agentName: 'weather-bot',
			parts: [
				{ type: 'reasoning', text: 'Checking location', state: 'done' },
				{
					type: 'tool-getWeather',
					toolCallId: 'tool-1',
					state: 'output-available',
					input: { latitude: 35.68, longitude: 139.69 },
					output: { temperature: 10.1, unit: 'C' }
				},
				{ type: 'text', text: 'Final answer' }
			]
		};

		const merged = mergeAssistantMessage(persisted, materialized);

		expect(merged.id).toBe('msg-1');
		expect(merged.metadata).toEqual({ provider: 'openai' });
		expect(merged.agentName).toBe('weather-bot');
		expect(merged.parts?.map((part) => part.type)).toEqual([
			'reasoning',
			'tool-getWeather',
			'text'
		]);
		expect(merged.text).toBe('Final answer');
	});
});

describe('mergeMaterializedStreamsIntoPage', () => {
	it('only replaces assistant messages with matching orders', () => {
		const page: ChatMessage[] = [
			{
				id: 'user-1',
				_creationTime: 1,
				role: 'user',
				status: 'success',
				order: 1,
				text: 'What is the weather?'
			},
			{
				id: 'assistant-1',
				_creationTime: 2,
				role: 'assistant',
				status: 'success',
				order: 1,
				stepOrder: 0,
				text: 'Old answer',
				parts: [{ type: 'text', text: 'Old answer' }]
			},
			{
				id: 'assistant-2',
				_creationTime: 3,
				role: 'assistant',
				status: 'success',
				order: 2,
				stepOrder: 0,
				text: 'Unaffected'
			}
		];

		const materialized: UIMessage[] = [
			{
				id: 'stream:1',
				key: 'thread-1-0',
				_creationTime: 4,
				role: 'assistant',
				status: 'success',
				order: 1,
				stepOrder: 0,
				text: 'New answer',
				parts: [
					{
						type: 'tool-getWeather',
						toolCallId: 'tool-1',
						state: 'output-available',
						input: { latitude: 35.68, longitude: 139.69 },
						output: { temperature: 10.1, unit: 'C' }
					},
					{ type: 'text', text: 'New answer' }
				]
			}
		];

		const merged = mergeMaterializedStreamsIntoPage(page, materialized);

		expect(merged[0]?.id).toBe('user-1');
		expect(merged[1]?.id).toBe('assistant-1');
		expect(merged[1]?.parts?.map((part) => part.type)).toEqual(['tool-getWeather', 'text']);
		expect(merged[1]?.text).toBe('New answer');
		expect(merged[2]?.text).toBe('Unaffected');
	});
});
