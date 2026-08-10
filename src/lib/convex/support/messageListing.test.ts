import { describe, expect, it, vi } from 'vitest';
import { listUIMessages, syncStreams, type UIMessage } from '@convex-dev/agent';
import type { ChatMessage } from '../../chat/core/types';
import {
	listMessagesForThread,
	mergeAssistantMessage,
	mergeMaterializedStreamsIntoPage
} from './messageListing';

vi.mock('@convex-dev/agent', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		listUIMessages: vi.fn(),
		syncStreams: vi.fn()
	};
});

describe('listMessagesForThread', () => {
	it('keeps metadata aligned with the newest page after 51 raw messages', async () => {
		const newestPage = Array.from({ length: 50 }, (_, index) => {
			const number = 51 - index;
			return {
				id: `message-${number}`,
				key: `thread-${number}-0`,
				_creationTime: number,
				role: 'assistant' as const,
				status: 'success' as const,
				order: number,
				stepOrder: 0,
				text: `Message ${number}`,
				parts: []
			};
		});
		vi.mocked(listUIMessages).mockResolvedValue({
			page: newestPage,
			isDone: false,
			continueCursor: 'next'
		});
		vi.mocked(syncStreams).mockResolvedValue({ kind: 'list', messages: [] });

		const runQuery = vi.fn((_reference, args: { order: 'asc' | 'desc' }) => {
			const messageNumbers =
				args.order === 'desc'
					? Array.from({ length: 50 }, (_, index) => 51 - index)
					: Array.from({ length: 50 }, (_, index) => index + 1);
			return Promise.resolve({
				page: messageNumbers.map((number) => ({
					_id: `message-${number}`,
					...(number === 51 ? { provider: 'human' } : {})
				}))
			});
		});

		const result = (await listMessagesForThread({ runQuery } as never, {
			threadId: 'thread-1',
			paginationOpts: { numItems: 50, cursor: null }
		})) as { page: ChatMessage[] };

		expect(runQuery).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ order: 'desc' })
		);
		expect(result.page[0]?.id).toBe('message-51');
		expect(result.page[0]?.metadata).toMatchObject({ provider: 'human' });
	});
});

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
