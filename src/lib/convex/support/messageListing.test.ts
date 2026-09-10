import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listMessages, syncStreams, type UIMessage } from '@convex-dev/agent';
import type { MessageDoc, StreamMessage } from '@convex-dev/agent/validators';
import type { ChatMessage } from '../../chat/core/types';
import { SAFE_TOOL_ERROR_MESSAGE } from '../../chat/core/tool-error-redaction';
import {
	listMessagesForThread,
	mergeAssistantMessage,
	mergeMaterializedStreamsIntoPage
} from './messageListing';

vi.mock('@convex-dev/agent', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		listMessages: vi.fn(),
		syncStreams: vi.fn()
	};
});

function rawMessage(overrides: Partial<MessageDoc> = {}): MessageDoc {
	return {
		_id: 'message-1',
		_creationTime: 1,
		threadId: 'thread-1',
		order: 1,
		stepOrder: 0,
		status: 'success',
		tool: false,
		message: { role: 'assistant', content: 'Message 1' },
		...overrides
	};
}

function toolFailure(output: unknown, overrides: Record<string, unknown> = {}): MessageDoc[] {
	return [
		rawMessage({
			_id: 'assistant-1',
			tool: true,
			provider: 'openrouter',
			providerMetadata: { provider: { requestId: 'request-1' } },
			message: {
				role: 'assistant',
				content: [
					{
						type: 'tool-call',
						toolCallId: 'call-1',
						toolName: 'weather',
						input: { city: 'Berlin' }
					}
				]
			}
		}),
		rawMessage({
			_id: 'tool-1',
			stepOrder: 1,
			tool: true,
			message: {
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call-1',
						toolName: 'weather',
						output,
						...overrides
					}
				]
			} as MessageDoc['message']
		})
	];
}

describe('listMessagesForThread', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(syncStreams).mockResolvedValue({ kind: 'list', messages: [] });
	});

	it('keeps metadata aligned with the newest page after 51 raw messages', async () => {
		const newestPage = Array.from({ length: 50 }, (_, index) => {
			const number = 51 - index;
			return rawMessage({
				_id: `message-${number}`,
				_creationTime: number,
				order: number,
				message: { role: 'assistant', content: `Message ${number}` },
				...(number === 51 ? { provider: 'human' } : {})
			});
		});
		vi.mocked(listMessages).mockResolvedValue({
			page: newestPage,
			isDone: false,
			continueCursor: 'next'
		});

		const result = await listMessagesForThread({ runQuery: vi.fn() } as never, {
			threadId: 'thread-1',
			paginationOpts: { numItems: 50, cursor: null }
		});

		expect(result.continueCursor).toBe('next');
		expect(result.isDone).toBe(false);
		expect(result.page.find((message) => message.id === 'message-51')?.metadata).toMatchObject({
			provider: 'human'
		});
	});

	it.each([
		{ type: 'error-text', value: 'PRIVATE_TEXT_DIAGNOSTIC' },
		{ type: 'error-json', value: { detail: 'PRIVATE_JSON_DIAGNOSTIC' } }
	])('normalizes persisted $type before toUIMessages unwraps it', async (output) => {
		vi.mocked(listMessages).mockResolvedValue({
			page: toolFailure(output),
			isDone: true,
			continueCursor: ''
		});

		const result = await listMessagesForThread({ runQuery: vi.fn() } as never, {
			threadId: 'thread-1',
			paginationOpts: { numItems: 50, cursor: null }
		});
		const toolPart = result.page[0]?.parts?.find((part) => part.type === 'tool-weather');

		expect(toolPart).toMatchObject({
			state: 'output-error',
			errorText: SAFE_TOOL_ERROR_MESSAGE,
			output: SAFE_TOOL_ERROR_MESSAGE
		});
		expect(result.page[0]?.metadata).toEqual({
			provider: 'openrouter',
			providerMetadata: { provider: { requestId: 'request-1' } }
		});
		expect(JSON.stringify(result)).not.toContain('PRIVATE_');
	});

	it('normalizes legacy isError results without redacting successful error-shaped data', async () => {
		vi.mocked(listMessages).mockResolvedValue({
			page: [
				...toolFailure(
					{ type: 'json', value: { detail: 'PRIVATE_LEGACY_DIAGNOSTIC' } },
					{ isError: true }
				),
				...toolFailure({
					type: 'json',
					value: { type: 'error-json', value: { error: 'domain value', ok: true } }
				}).map((message) => ({ ...message, _id: `success-${message._id}`, order: 2 }))
			],
			isDone: true,
			continueCursor: ''
		});

		const result = await listMessagesForThread({ runQuery: vi.fn() } as never, {
			threadId: 'thread-1',
			paginationOpts: { numItems: 50, cursor: null }
		});

		expect(JSON.stringify(result.page[0])).not.toContain('PRIVATE_LEGACY_DIAGNOSTIC');
		expect(JSON.stringify(result.page[1])).toContain('domain value');
	});

	it('does not query message rows for a zero-page stream request', async () => {
		vi.mocked(listMessages).mockResolvedValue({ page: [], isDone: true, continueCursor: '' });
		vi.mocked(syncStreams).mockResolvedValue({ kind: 'list', messages: [] });

		const result = await listMessagesForThread({ runQuery: vi.fn() } as never, {
			threadId: 'thread-1',
			paginationOpts: { numItems: 0, cursor: 'cursor-1' }
		});

		expect(listMessages).toHaveBeenCalledOnce();
		expect(result.page).toEqual([]);
		expect(result.streams).toEqual({ kind: 'list', messages: [] });
	});

	it('redacts delta-only responses without changing cursor boundaries or part ordering', async () => {
		vi.mocked(listMessages).mockResolvedValue({ page: [], isDone: true, continueCursor: '' });
		vi.mocked(syncStreams).mockResolvedValue({
			kind: 'deltas',
			deltas: [
				{
					streamId: 'stream-1',
					start: 4,
					end: 6,
					parts: [
						{ type: 'text-delta', id: 'text-1', delta: 'kept' },
						{
							type: 'tool-output-error',
							toolCallId: 'call-1',
							errorText: 'PRIVATE_DELTA_DIAGNOSTIC'
						}
					]
				}
			]
		});

		const result = await listMessagesForThread({ runQuery: vi.fn() } as never, {
			threadId: 'thread-1',
			paginationOpts: { numItems: 0, cursor: null },
			streamArgs: { kind: 'deltas', cursors: [{ streamId: 'stream-1', cursor: 4 }] }
		});

		expect(result.streams).toMatchObject({
			kind: 'deltas',
			deltas: [{ streamId: 'stream-1', start: 4, end: 6 }]
		});
		if (result.streams?.kind !== 'deltas') throw new Error('Expected deltas');
		expect(result.streams.deltas[0]!.parts).toHaveLength(2);
		expect(result.streams.deltas[0]!.parts[0]).toMatchObject({ delta: 'kept' });
		expect(JSON.stringify(result.streams)).not.toContain('PRIVATE_DELTA_DIAGNOSTIC');
	});

	it('redacts directly loaded materialization deltas before legacy decoding', async () => {
		vi.mocked(listMessages).mockResolvedValue({
			page: [rawMessage({ order: 1 })],
			isDone: true,
			continueCursor: ''
		});
		vi.mocked(syncStreams).mockResolvedValue({
			kind: 'list',
			messages: [
				{
					streamId: 'stream-1',
					status: 'streaming',
					format: 'TextStreamPart',
					order: 1,
					stepOrder: 0
				} satisfies StreamMessage
			]
		});
		const runQuery = vi.fn().mockResolvedValue([
			{
				streamId: 'stream-1',
				start: 0,
				end: 2,
				parts: [
					{
						type: 'tool-call',
						toolCallId: 'call-1',
						toolName: 'weather',
						input: { city: 'Berlin' }
					},
					{
						type: 'tool-error',
						toolCallId: 'call-1',
						toolName: 'weather',
						input: { city: 'Berlin' },
						error: 'PRIVATE_MATERIALIZATION_DIAGNOSTIC'
					}
				]
			}
		]);

		const result = await listMessagesForThread({ runQuery } as never, {
			threadId: 'thread-1',
			paginationOpts: { numItems: 50, cursor: null },
			streamArgs: { kind: 'list' }
		});

		expect(result.page[0]?.parts).toContainEqual(
			expect.objectContaining({
				type: 'tool-weather',
				state: 'output-error',
				errorText: SAFE_TOOL_ERROR_MESSAGE
			})
		);
		expect(JSON.stringify(result)).not.toContain('PRIVATE_MATERIALIZATION_DIAGNOSTIC');
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
