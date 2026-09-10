import { describe, expect, it, vi } from 'vitest';
import { Agent, listMessages } from '@convex-dev/agent';
import type { MessageDoc, StreamMessage } from '@convex-dev/agent/validators';
import { stepCountIs, tool, type UIMessageChunk } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import * as z from 'zod';
import { getFunctionAddress, type FunctionArgs } from 'convex/server';
import { components } from '$lib/convex/_generated/api';
import { deriveUIMessagesFromDeltas } from './stream-materialization';
import {
	prepareToolErrorRedactionStep,
	redactLanguageModelProviderErrors,
	SAFE_TOOL_ERROR_MESSAGE,
	toolErrorRedactionTransform
} from './tool-error-redaction';

const SENTINEL = 'PRIVATE_PROVIDER_DIAGNOSTIC';
const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 }
};

type AddMessagesArgs = FunctionArgs<typeof components.agent.messages.addMessages>;

type AgentFixture = {
	ctx: Parameters<Agent['streamText']>[0];
	addMessages: AddMessagesArgs[];
	deltas: Array<{ streamId: string; start: number; end: number; parts: unknown[] }>;
	finalizations: unknown[];
	events: string[];
};

function isAddMessagesArgs(value: unknown): value is AddMessagesArgs {
	return (
		typeof value === 'object' &&
		value !== null &&
		'threadId' in value &&
		typeof value.threadId === 'string' &&
		'messages' in value &&
		Array.isArray(value.messages)
	);
}

function isAgentFunction(reference: unknown, path: string): boolean {
	const address = getFunctionAddress(reference);
	return typeof address.reference === 'string' && address.reference.endsWith(`/agent/${path}`);
}

function createAgentFixture(): AgentFixture {
	const addMessages: AddMessagesArgs[] = [];
	const deltas: AgentFixture['deltas'] = [];
	const finalizations: unknown[] = [];
	const events: string[] = [];
	let messageSequence = 0;
	let order = 0;

	const runQuery = vi.fn(async (reference: unknown) => {
		if (isAgentFunction(reference, 'messages/listMessagesByThreadId')) {
			return { page: [], isDone: true, continueCursor: '' };
		}
		if (isAgentFunction(reference, 'streams/listDeltas')) return [];
		throw new Error('Unexpected Agent query');
	});
	const runMutation = vi.fn(async (reference: unknown, args: unknown) => {
		if (isAgentFunction(reference, 'messages/addMessages')) {
			if (!isAddMessagesArgs(args)) throw new Error('Invalid addMessages fixture input');
			addMessages.push(args);
			events.push(`save:${args.finishStreamId ? 'final' : 'step'}`);
			if (!args.pendingMessageId) order += 1;
			return {
				messages: args.messages.map((entry, index): MessageDoc => {
					const content = entry.message.content;
					const toolMessage =
						entry.message.role === 'tool' ||
						(Array.isArray(content) &&
							content.some(
								(part) =>
									typeof part === 'object' &&
									part !== null &&
									'type' in part &&
									typeof part.type === 'string' &&
									part.type.startsWith('tool-')
							));
					return {
						_id: `message-${++messageSequence}`,
						_creationTime: messageSequence,
						threadId: args.threadId,
						userId: args.userId,
						order,
						stepOrder: index,
						status: entry.status ?? 'success',
						tool: toolMessage,
						message: entry.message,
						...(entry.error && typeof entry.error === 'string' ? { error: entry.error } : {})
					};
				})
			};
		}
		if (isAgentFunction(reference, 'messages/finalizeMessage')) {
			finalizations.push(args);
			events.push('finalize:failed');
			return null;
		}
		if (isAgentFunction(reference, 'streams/create')) {
			events.push('stream:create');
			return 'stream-1';
		}
		if (isAgentFunction(reference, 'streams/addDelta')) {
			const delta = args as AgentFixture['deltas'][number];
			deltas.push(delta);
			events.push('stream:delta');
			return true;
		}
		if (isAgentFunction(reference, 'streams/finish')) {
			events.push('stream:finish');
			return null;
		}
		if (isAgentFunction(reference, 'streams/abort')) {
			finalizations.push(args);
			events.push('stream:abort');
			return null;
		}
		throw new Error('Unexpected Agent mutation');
	});

	const fixture = {
		runQuery,
		runMutation,
		runAction: vi.fn(async () => {
			throw new Error('Unexpected Agent action');
		}),
		storage: {},
		auth: { getUserIdentity: vi.fn(async () => null) }
	};

	return {
		ctx: fixture as Parameters<Agent['streamText']>[0],
		addMessages,
		deltas,
		finalizations,
		events
	};
}

function twoStepModel(): MockLanguageModelV4 {
	let call = 0;
	return new MockLanguageModelV4({
		doStream: async () => {
			call += 1;
			const parts =
				call === 1
					? [
							{ type: 'stream-start' as const, warnings: [] },
							{
								type: 'tool-call' as const,
								toolCallId: 'call-1',
								toolName: 'operation',
								input: '{}'
							},
							{
								type: 'finish' as const,
								finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
								usage
							}
						]
					: [
							{ type: 'stream-start' as const, warnings: [] },
							{ type: 'text-start' as const, id: 'text-1' },
							{ type: 'text-delta' as const, id: 'text-1', delta: 'Complete' },
							{ type: 'text-end' as const, id: 'text-1' },
							{
								type: 'finish' as const,
								finishReason: { unified: 'stop' as const, raw: 'stop' },
								usage
							}
						];
			return {
				stream: new ReadableStream({
					start(controller) {
						for (const part of parts) controller.enqueue(part);
						controller.close();
					}
				})
			};
		}
	});
}

async function runAgentTurn(execute: () => Promise<unknown>) {
	const fixture = createAgentFixture();
	const model = twoStepModel();
	const steps: unknown[] = [];
	const chunks: unknown[] = [];
	const agent = new Agent(components.agent, {
		name: 'contract-agent',
		languageModel: redactLanguageModelProviderErrors(model),
		tools: {
			operation: tool({ inputSchema: z.object({}), execute })
		}
	});

	const result = await agent.streamText(
		fixture.ctx,
		{ threadId: 'thread-1', userId: 'user-1' },
		{
			prompt: 'Run the operation',
			stopWhen: stepCountIs(2),
			prepareStep: prepareToolErrorRedactionStep,
			experimental_transform: toolErrorRedactionTransform,
			onChunk: ({ chunk }) => {
				chunks.push(chunk);
			},
			onStepEnd: (step) => {
				steps.push(step);
			}
		},
		{
			saveStreamDeltas: { chunking: 'line', throttleMs: 0 }
		}
	);
	await result.consumeStream();

	const uiChunks: UIMessageChunk[] = [];
	for await (const chunk of result.toUIMessageStream()) uiChunks.push(chunk);
	return { fixture, model, steps, chunks, uiChunks };
}

describe('Agent 0.7.1 and AI SDK 7 error boundary', () => {
	it('redacts a protocol failure before continuation, persistence, deltas, and UI output', async () => {
		const captured = await runAgentTurn(async () => {
			throw new Error(SENTINEL);
		});

		expect(captured.model.doStreamCalls).toHaveLength(2);
		expect(JSON.stringify(captured.model.doStreamCalls[1]!.prompt)).not.toContain(SENTINEL);
		expect(JSON.stringify(captured.steps)).not.toContain(SENTINEL);
		expect(JSON.stringify(captured.fixture.addMessages)).not.toContain(SENTINEL);
		expect(JSON.stringify(captured.fixture.deltas)).not.toContain(SENTINEL);
		expect(JSON.stringify(captured.chunks)).not.toContain(SENTINEL);
		expect(JSON.stringify(captured.uiChunks)).not.toContain(SENTINEL);
		expect(JSON.stringify(captured)).toContain(SAFE_TOOL_ERROR_MESSAGE);
		expect(captured.fixture.events.filter((event) => event.startsWith('save:'))).toEqual([
			'save:step',
			'save:step',
			'save:final'
		]);
		expect(captured.fixture.events.indexOf('stream:delta')).toBeLessThan(
			captured.fixture.events.indexOf('save:final')
		);
	});

	it('preserves successful error-shaped business output through every Agent sink', async () => {
		const output = {
			type: 'error-json' as const,
			value: { error: 'domain state', recoverable: true }
		};
		const captured = await runAgentTurn(async () => output);
		const boundary = {
			prompt: captured.model.doStreamCalls[1]!.prompt,
			steps: captured.steps,
			messages: captured.fixture.addMessages,
			deltas: captured.fixture.deltas,
			chunks: captured.chunks,
			uiChunks: captured.uiChunks
		};

		expect(boundary.prompt).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: 'tool',
					content: [expect.objectContaining({ output: { type: 'json', value: output } })]
				})
			])
		);
		expect(JSON.stringify(boundary)).toContain('error-json');
		expect(JSON.stringify(boundary)).toContain('domain state');
		expect(JSON.stringify(boundary)).not.toContain(SAFE_TOOL_ERROR_MESSAGE);
	});

	it('sanitizes provider error events before Agent failure finalization and abort persistence', async () => {
		const fixture = createAgentFixture();
		const model = new MockLanguageModelV4({
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: 'stream-start', warnings: [] });
						controller.enqueue({ type: 'error', error: new Error(SENTINEL) });
						controller.close();
					}
				})
			})
		});
		const agent = new Agent(components.agent, {
			name: 'error-agent',
			languageModel: redactLanguageModelProviderErrors(model)
		});
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await agent.streamText(
			fixture.ctx,
			{ threadId: 'thread-1', userId: 'user-1' },
			{
				prompt: 'Fail safely',
				prepareStep: prepareToolErrorRedactionStep,
				experimental_transform: toolErrorRedactionTransform
			},
			{ saveStreamDeltas: { chunking: 'line', throttleMs: 0 } }
		);
		await result.consumeStream();
		consoleError.mockRestore();

		expect(JSON.stringify(fixture.finalizations)).not.toContain(SENTINEL);
		expect(JSON.stringify(fixture.deltas)).not.toContain(SENTINEL);
		expect(JSON.stringify(fixture)).toContain(SAFE_TOOL_ERROR_MESSAGE);
	});

	it('decodes sanitized UIMessageChunk and legacy stream fixtures', async () => {
		const streams = [
			{
				streamId: 'ui-stream',
				status: 'streaming',
				format: 'UIMessageChunk',
				order: 1,
				stepOrder: 0
			},
			{
				streamId: 'legacy-stream',
				status: 'streaming',
				format: 'TextStreamPart',
				order: 2,
				stepOrder: 0
			}
		] satisfies StreamMessage[];
		const messages = await deriveUIMessagesFromDeltas('thread-1', streams, [
			{
				streamId: 'ui-stream',
				start: 0,
				end: 2,
				parts: [
					{
						type: 'tool-input-available',
						toolCallId: 'ui-call',
						toolName: 'operation',
						input: {}
					},
					{
						type: 'tool-output-error',
						toolCallId: 'ui-call',
						errorText: SENTINEL
					}
				]
			},
			{
				streamId: 'legacy-stream',
				start: 0,
				end: 2,
				parts: [
					{
						type: 'tool-call',
						toolCallId: 'legacy-call',
						toolName: 'operation',
						input: {}
					},
					{
						type: 'tool-error',
						toolCallId: 'legacy-call',
						toolName: 'operation',
						input: {},
						error: SENTINEL
					}
				]
			}
		]);

		expect(JSON.stringify(messages)).not.toContain(SENTINEL);
		expect(messages.flatMap((message) => message.parts)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ state: 'output-error', errorText: SAFE_TOOL_ERROR_MESSAGE })
			])
		);
	});

	it('uses the installed Agent zero-page shortcut without querying message rows', async () => {
		const runQuery = vi.fn(async () => {
			throw new Error('zero-page listing must not query');
		});
		const result = await listMessages(
			{ runQuery } as Parameters<typeof listMessages>[0],
			components.agent,
			{
				threadId: 'thread-1',
				paginationOpts: { numItems: 0, cursor: 'cursor-1' }
			}
		);

		expect(runQuery).not.toHaveBeenCalled();
		expect(result).toEqual({ page: [], isDone: true, continueCursor: 'cursor-1' });
	});
});
