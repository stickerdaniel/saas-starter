// A tool call and its result are separate stored rows, and the Convex agent marks the
// call's row `success` before the result row exists. The phase a tool line shows is read
// from what the real `toUIMessages` makes of those rows, so an agent upgrade that changes
// either the row split or the status it reports fails here. The rows themselves are
// hand-written in the shape `reasoning-handover.contract.test.ts` pins.

import { describe, expect, it } from 'vitest';
import { toUIMessages } from '@convex-dev/agent';
import { normalizeMessage } from '../core/message-extraction.js';
import { StreamCacheManager } from '../core/stream-cache.js';
import type { ChatMessage } from '../core/types.js';
import { deriveOrderedParts } from './ordered-parts.js';
import { buildDisplayMessages } from './streaming-display.js';

type RowStatus = 'pending' | 'success' | 'failed';

function toolCallRow(status: RowStatus) {
	return {
		_id: 'm1',
		_creationTime: 1,
		order: 0,
		stepOrder: 0,
		status,
		threadId: 'thread-1',
		tool: true,
		message: {
			role: 'assistant',
			content: [
				{
					type: 'tool-call',
					toolCallId: 'call-1',
					toolName: 'lookup',
					input: { city: 'Aachen' },
					args: { city: 'Aachen' }
				}
			]
		}
	};
}

const toolResultRow = {
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
				output: { type: 'json', value: { forecast: 'Sunny' } }
			}
		]
	}
};

/** The tool line a reader sees for the stored rows, through the display path. */
function toolLine(rows: object[]) {
	const [message] = toUIMessages(rows as any).filter((m) => m.role === 'assistant');
	if (!message) throw new Error('expected one assistant message');
	const display = buildDisplayMessages({
		allMessages: [normalizeMessage(message as unknown as ChatMessage)],
		streamMessages: [],
		streamingUIMessages: [],
		streamCache: new StreamCacheManager()
	})[0]!;
	const tools = deriveOrderedParts(display.parts, display.status).filter(
		(part) => part.kind === 'tool'
	);
	expect(tools).toHaveLength(1);
	return { status: display.status, state: tools[0]!.toolPart.state, phase: tools[0]!.phase };
}

describe('tool phase from stored agent rows', () => {
	it('keeps a stored call that awaits its result running', () => {
		expect(toolLine([toolCallRow('success')])).toEqual({
			status: 'success',
			state: 'input-available',
			phase: 'running'
		});
	});

	it('reads the call as ran once its result row arrives', () => {
		expect(toolLine([toolCallRow('success'), toolResultRow])).toMatchObject({
			state: 'output-available',
			phase: 'ran'
		});
	});

	it('reads a call left without output by a failed message as failed', () => {
		expect(toolLine([toolCallRow('failed')])).toEqual({
			status: 'failed',
			state: 'input-available',
			phase: 'failed'
		});
	});
});
