// The reasoning merge exists because the two producers describe the same
// response differently, so the shapes it merges come from the real producers
// here rather than from hand-written parts: `readUIMessageStream` from the AI
// SDK for the live snapshot, `toUIMessages` from the Convex agent for the
// persisted copy. A hand-written pair is a claim about those packages, and this
// file is what turns the claim into something an upgrade can fail.
//
// The stored rows the persisted producer reads are the one hand-written input,
// because the Convex agent does not export the serializer that writes them. The
// two shapes a hand-written row gets wrong are pinned instead: a tool call
// carries `input` and the deprecated `args`, and a tool result wraps its output
// in a tagged `{ type, value }` envelope (both measured against the agent's
// mapping). `toUIMessages` normalizes an untagged output, so a row that skipped
// the envelope would stay green while exercising a legacy form the producer no
// longer writes.

import { describe, expect, it } from 'vitest';
import { readUIMessageStream } from 'ai';
import { toUIMessages } from '@convex-dev/agent';
import type { UIMessage } from '@convex-dev/agent';
import { mergeAssistantMessageParts } from './stream-materialization.js';

/** The wire chunks a two-step tool response produces, in order. */
function responseChunks(firstThought: string, secondThought: string) {
	return [
		{ type: 'start' },
		{ type: 'start-step' },
		{ type: 'reasoning-start', id: 'r-first' },
		{ type: 'reasoning-delta', id: 'r-first', delta: firstThought },
		{ type: 'reasoning-end', id: 'r-first' },
		{ type: 'tool-input-start', toolCallId: 'call-1', toolName: 'lookup' },
		{ type: 'tool-input-available', toolCallId: 'call-1', toolName: 'lookup', input: {} },
		{ type: 'tool-output-available', toolCallId: 'call-1', output: { ok: true } },
		{ type: 'finish-step' },
		{ type: 'start-step' },
		{ type: 'reasoning-start', id: 'r-second' },
		{ type: 'reasoning-delta', id: 'r-second', delta: secondThought },
		{ type: 'reasoning-end', id: 'r-second' },
		{ type: 'text-start', id: 't-1' },
		{ type: 'text-delta', id: 't-1', delta: 'the answer' },
		{ type: 'text-end', id: 't-1' },
		{ type: 'finish-step' },
		{ type: 'finish' }
	];
}

/** The stored rows the same response leaves behind, in order. */
function responseRows(firstThought: string, secondThought: string) {
	return [
		{
			_id: 'm1',
			_creationTime: 1,
			order: 0,
			stepOrder: 0,
			status: 'success',
			threadId: 'thread-1',
			// What the agent's `isTool` writes for a row whose content carries a
			// tool call, and what keeps the three rows in one assistant group.
			tool: true,
			message: {
				role: 'assistant',
				content: [
					{ type: 'reasoning', text: firstThought },
					{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: {}, args: {} }
				]
			}
		},
		{
			_id: 'm2',
			_creationTime: 2,
			order: 0,
			stepOrder: 1,
			status: 'success',
			threadId: 'thread-1',
			tool: true,
			message: {
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call-1',
						toolName: 'lookup',
						output: { type: 'json', value: { ok: true } }
					}
				]
			}
		},
		{
			_id: 'm3',
			_creationTime: 3,
			order: 0,
			stepOrder: 2,
			status: 'success',
			threadId: 'thread-1',
			tool: false,
			message: {
				role: 'assistant',
				content: [
					{ type: 'reasoning', text: secondThought },
					{ type: 'text', text: 'the answer' }
				]
			}
		}
	];
}

/**
 * The same response in two vocabularies. A model that opens its second thought
 * with the words of its first one gives the merge nothing to tell the two apart
 * by, which is where the order the blocks arrive in becomes the only evidence
 * left.
 */
const RESPONSES = [
	{ name: 'thoughts that share no words', first: 'first thought', second: 'second thought' },
	{
		name: 'a second thought that repeats the first',
		first: 'Analyze',
		second: 'Analyze alternatives'
	}
];

async function readLiveMessage(first: string, second: string): Promise<UIMessage> {
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of responseChunks(first, second)) controller.enqueue(chunk);
			controller.close();
		}
	});

	let latest: UIMessage | undefined;
	for await (const message of readUIMessageStream({ stream } as any)) {
		latest = message as UIMessage;
	}

	if (!latest) throw new Error('the AI SDK reader produced no message');
	return latest;
}

function readPersistedMessage(first: string, second: string): UIMessage {
	const messages = toUIMessages(responseRows(first, second) as any) as UIMessage[];
	const assistant = messages.filter((message) => message.role === 'assistant');
	if (assistant.length !== 1) {
		throw new Error(`expected one grouped assistant message, got ${assistant.length}`);
	}
	return assistant[0]!;
}

describe('the reasoning shapes the two producers emit', () => {
	// The asymmetry the whole merge is built around. If an upgrade makes the two
	// sides agree, the id-blind matching below stops being necessary; if it makes
	// them disagree differently, the matching stops working. Either way this is
	// the assertion that says so.
	it('stamps an id on the live side and none on the persisted side', async () => {
		const live = await readLiveMessage('first thought', 'second thought');
		const persisted = readPersistedMessage('first thought', 'second thought');

		const liveReasoning = live.parts.filter((part) => part.type === 'reasoning');
		const persistedReasoning = persisted.parts.filter((part) => part.type === 'reasoning');

		expect(liveReasoning).toHaveLength(2);
		expect(persistedReasoning).toHaveLength(2);
		for (const part of liveReasoning) {
			expect(typeof (part as { id?: unknown }).id).toBe('string');
		}
		// Both fields are identifiers to the merge (`getReasoningPartId` reads `id`
		// and the legacy decoder's `streamPartId`), so pinning only one would let a
		// release that starts stamping the other pass while the id-blind path it
		// guards stops being exercised at all.
		for (const part of persistedReasoning) {
			const record = part as { id?: unknown; streamPartId?: unknown };
			expect(record.id).toBeUndefined();
			expect(record.streamPartId).toBeUndefined();
		}
	});
});

describe.each(RESPONSES)('the persisted and streamed handover of $name', ({ first, second }) => {
	it('keeps one block per reasoning step', async () => {
		const live = await readLiveMessage(first, second);
		const persisted = readPersistedMessage(first, second);

		const merged = mergeAssistantMessageParts(persisted.parts, live.parts);

		expect(merged.filter((part) => part.type === 'reasoning')).toHaveLength(2);
		expect(merged.filter((part) => part.type === 'text')).toHaveLength(1);
	});
});
