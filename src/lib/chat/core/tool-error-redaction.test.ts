import { describe, expect, it } from 'vitest';
import {
	stepCountIs,
	streamText,
	tool,
	type ModelMessage,
	type TextStreamPart,
	type ToolSet
} from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import * as z from 'zod';
import type { MessageDoc, StreamDelta } from '@convex-dev/agent/validators';
import {
	prepareToolErrorRedactionStep,
	redactMessageDocToolErrors,
	redactModelMessages,
	redactStreamDeltas,
	redactToolErrorStreamPart,
	SAFE_TOOL_ERROR_MESSAGE,
	toolErrorRedactionTransform
} from './tool-error-redaction';

const SENTINEL = 'PRIVATE_PROVIDER_DIAGNOSTIC';
const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 }
};

function messageDoc(content: unknown[], overrides: Partial<MessageDoc> = {}): MessageDoc {
	return {
		_id: 'message-1',
		_creationTime: 1,
		threadId: 'thread-1',
		order: 1,
		stepOrder: 0,
		status: 'success',
		tool: true,
		message: { role: 'tool', content } as MessageDoc['message'],
		...overrides
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
							{ type: 'text-delta' as const, id: 'text-1', delta: 'Recovered' },
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

describe('tool error redaction', () => {
	it.each(['error-text', 'error-json'] as const)(
		'redacts persisted %s outputs before their wrapper is unwrapped',
		(type) => {
			const source = messageDoc([
				{
					type: 'tool-result',
					toolCallId: 'call-1',
					toolName: 'weather',
					output: { type, value: type === 'error-json' ? { detail: SENTINEL } : SENTINEL }
				}
			]);

			const redacted = redactMessageDocToolErrors(source);
			const part = (redacted.message!.content as Array<Record<string, unknown>>)[0]!;

			expect(part.isError).toBe(true);
			expect(part.output).toEqual({ type, value: SAFE_TOOL_ERROR_MESSAGE });
			expect(JSON.stringify(redacted)).not.toContain(SENTINEL);
			expect(JSON.stringify(source)).toContain(SENTINEL);
		}
	);

	it('uses isError and MessageDoc.error as error markers without mutating the source', () => {
		const source = messageDoc(
			[
				{
					type: 'tool-result',
					toolCallId: 'call-1',
					toolName: 'weather',
					output: { type: 'json', value: { detail: SENTINEL } },
					result: { detail: SENTINEL },
					isError: true
				}
			],
			{ error: SENTINEL }
		);

		const redacted = redactMessageDocToolErrors(source);
		const part = (redacted.message!.content as Array<Record<string, unknown>>)[0]!;

		expect(redacted.error).toBe(SAFE_TOOL_ERROR_MESSAGE);
		expect(part.output).toEqual({ type: 'json', value: SAFE_TOOL_ERROR_MESSAGE });
		expect(part.result).toBe(SAFE_TOOL_ERROR_MESSAGE);
		expect(JSON.stringify(redacted)).not.toContain(SENTINEL);
		expect(JSON.stringify(source)).toContain(SENTINEL);
	});

	it('leaves successful output data with nested error shapes unchanged', () => {
		const output = {
			type: 'json',
			value: { type: 'error-json', value: { error: 'domain value', ok: true } }
		};
		const source = messageDoc([
			{
				type: 'tool-result',
				toolCallId: 'call-1',
				toolName: 'lookup',
				output
			}
		]);

		expect(redactMessageDocToolErrors(source)).toBe(source);
		expect((source.message!.content as Array<{ output: unknown }>)[0]!.output).toBe(output);
	});

	it('redacts tool results in model prompts and the prepareStep result', () => {
		const messages: ModelMessage[] = [
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call-1',
						toolName: 'weather',
						output: { type: 'error-text', value: SENTINEL }
					}
				]
			}
		];

		const redacted = redactModelMessages(messages);
		const prepared = prepareToolErrorRedactionStep({ messages });

		expect(JSON.stringify(redacted)).not.toContain(SENTINEL);
		expect(JSON.stringify(prepared.messages)).not.toContain(SENTINEL);
		expect(JSON.stringify(messages)).toContain(SENTINEL);
	});

	it.each([
		{
			part: {
				type: 'tool-error',
				toolCallId: 'call-1',
				toolName: 'weather',
				input: {},
				error: SENTINEL
			},
			field: 'error'
		},
		{
			part: {
				type: 'tool-call',
				toolCallId: 'call-1',
				toolName: 'missing',
				input: {},
				dynamic: true,
				invalid: true,
				error: SENTINEL
			},
			field: 'error'
		},
		{ part: { type: 'error', error: SENTINEL }, field: 'error' },
		{ part: { type: 'error', errorText: SENTINEL }, field: 'errorText' },
		{
			part: {
				type: 'tool-input-error',
				toolCallId: 'call-1',
				toolName: 'weather',
				input: {},
				errorText: SENTINEL
			},
			field: 'errorText'
		},
		{
			part: { type: 'tool-output-error', toolCallId: 'call-1', errorText: SENTINEL },
			field: 'errorText'
		},
		{ part: { type: 'abort', reason: SENTINEL }, field: 'reason' },
		{
			part: {
				type: 'dynamic-tool',
				toolName: 'runtime-tool',
				toolCallId: 'call-1',
				state: 'output-error',
				input: {},
				errorText: SENTINEL
			},
			field: 'errorText'
		}
	])('redacts the $part.type protocol marker', ({ part, field }) => {
		const redacted = redactToolErrorStreamPart(part);
		expect(redacted[field as keyof typeof redacted]).toBe(SAFE_TOOL_ERROR_MESSAGE);
		expect(JSON.stringify(part)).toContain(SENTINEL);
	});

	it('preserves successful stream tool output that resembles a persisted error envelope', async () => {
		const output = {
			type: 'error-json',
			value: { error: 'domain state', recoverable: true }
		};
		const toolResult: TextStreamPart<ToolSet> = {
			type: 'tool-result',
			toolCallId: 'call-1',
			toolName: 'lookup',
			input: {},
			output
		};
		const transform = toolErrorRedactionTransform({ tools: {}, stopStream: () => {} });
		const source = new ReadableStream<TextStreamPart<ToolSet>>({
			start(controller) {
				controller.enqueue(toolResult);
				controller.close();
			}
		});
		const parts: Array<TextStreamPart<ToolSet>> = [];
		for await (const part of source.pipeThrough(transform)) parts.push(part);

		expect(parts).toEqual([toolResult]);
		expect(parts[0]).toBe(toolResult);
	});

	it('preserves stream delta identity, cursors, part count, and ordering', () => {
		const deltas: StreamDelta[] = [
			{
				streamId: 'stream-1',
				start: 3,
				end: 5,
				parts: [
					{ type: 'text-delta', id: 'text-1', text: 'first' },
					{
						type: 'tool-error',
						toolCallId: 'call-1',
						toolName: 'weather',
						input: {},
						error: SENTINEL
					}
				]
			}
		];

		const redacted = redactStreamDeltas(deltas);

		expect(redacted[0]).toMatchObject({ streamId: 'stream-1', start: 3, end: 5 });
		expect(redacted[0]!.parts).toHaveLength(2);
		expect(redacted[0]!.parts[0]).toEqual(deltas[0]!.parts[0]);
		expect(JSON.stringify(redacted)).not.toContain(SENTINEL);
		expect(JSON.stringify(deltas)).toContain(SENTINEL);
	});

	it('keeps tool failures out of the next model prompt and UI stream', async () => {
		const model = twoStepModel();
		const finishedSteps: unknown[] = [];
		const result = streamText({
			model,
			messages: [{ role: 'user', content: 'Run the tool' }],
			tools: {
				operation: tool({
					inputSchema: z.object({}),
					execute: async (): Promise<string> => {
						throw new Error(SENTINEL);
					}
				})
			},
			stopWhen: stepCountIs(2),
			prepareStep: prepareToolErrorRedactionStep,
			experimental_transform: toolErrorRedactionTransform,
			onStepEnd: (step) => {
				finishedSteps.push(step);
			}
		});

		const chunks = [];
		for await (const chunk of result.toUIMessageStream()) chunks.push(chunk);

		expect(model.doStreamCalls).toHaveLength(2);
		expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).not.toContain(SENTINEL);
		expect(JSON.stringify(finishedSteps)).not.toContain(SENTINEL);
		expect(JSON.stringify(chunks)).not.toContain(SENTINEL);
		expect(chunks).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'tool-output-error' })])
		);
	});

	it('keeps successful error-shaped business output through a two-step stream', async () => {
		const model = twoStepModel();
		const output = {
			type: 'error-json' as const,
			value: { error: 'domain state', recoverable: true }
		};
		const finishedSteps: unknown[] = [];
		const result = streamText({
			model,
			messages: [{ role: 'user', content: 'Run the tool' }],
			tools: {
				operation: tool({
					inputSchema: z.object({}),
					execute: async () => output
				})
			},
			stopWhen: stepCountIs(2),
			prepareStep: prepareToolErrorRedactionStep,
			experimental_transform: toolErrorRedactionTransform,
			onStepEnd: (step) => {
				finishedSteps.push(step);
			}
		});

		const chunks = [];
		for await (const chunk of result.toUIMessageStream()) chunks.push(chunk);

		expect(model.doStreamCalls).toHaveLength(2);
		expect(model.doStreamCalls[1]!.prompt).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: 'tool',
					content: [expect.objectContaining({ output: { type: 'json', value: output } })]
				})
			])
		);
		expect(finishedSteps).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					toolResults: [expect.objectContaining({ output })]
				})
			])
		);
		expect(chunks).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'tool-output-available', output })])
		);
		expect(
			JSON.stringify({ prompt: model.doStreamCalls[1]!.prompt, finishedSteps, chunks })
		).not.toContain(SAFE_TOOL_ERROR_MESSAGE);
	});

	it('redacts errors through the installed AI SDK stream transform contract', async () => {
		const transform = toolErrorRedactionTransform({ tools: {}, stopStream: () => {} });
		const source = new ReadableStream<TextStreamPart<ToolSet>>({
			start(controller) {
				controller.enqueue({ type: 'error', error: SENTINEL });
				controller.close();
			}
		});
		const parts = [];
		for await (const part of source.pipeThrough(transform)) parts.push(part);

		expect(parts).toEqual([{ type: 'error', error: SAFE_TOOL_ERROR_MESSAGE }]);
	});
});
