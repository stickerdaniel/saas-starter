import type { ToolCtx } from '@convex-dev/agent';
import { asSchema } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from '../../../convex/_generated/api';
import { requestHandoff } from './handoff';

const executeOptions = {
	abortSignal: new AbortController().signal,
	toolCallId: 'handoff-test',
	messages: [],
	context: {}
};

async function executeRequestHandoff(
	ctx: { threadId?: string; runMutation: ReturnType<typeof vi.fn> },
	input: unknown = {}
) {
	const tool = { ...requestHandoff, ctx: ctx as unknown as ToolCtx };
	if (!tool.execute) {
		throw new Error('requestHandoff must be executable');
	}
	const decoded = await asSchema(requestHandoff.inputSchema).validate?.(input);
	if (!decoded?.success) {
		throw new Error('requestHandoff refused its input');
	}
	return tool.execute(decoded.value, executeOptions);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('requestHandoff', () => {
	it('requests the handoff transition without logging model input', async () => {
		const marker = 'visitor-private-marker';
		const runMutation = vi.fn().mockResolvedValue(null);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		const result = await executeRequestHandoff(
			{ threadId: 'thread-1', runMutation },
			{ reason: marker }
		);

		expect(runMutation).toHaveBeenCalledWith(internal.support.handoff.internalSetHandoff, {
			threadId: 'thread-1'
		});
		expect(log).not.toHaveBeenCalled();
		expect(result).toBe(
			'The team has been brought in and will reply right here in this chat. Let the user know, and tell them they can leave their email in the field below the chat to get notified when the team replies.'
		);
	});

	it('advertises an empty input object to the model', async () => {
		expect(await asSchema(requestHandoff.inputSchema).jsonSchema).toEqual({
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			properties: {},
			additionalProperties: false
		});
	});

	it('decodes any object from the model to an empty input', async () => {
		expect(
			await asSchema(requestHandoff.inputSchema).validate?.({ $reason: 'visitor-private-marker' })
		).toEqual({ success: true, value: {} });
	});

	it.each([null, [], 'help', 1])('refuses %j as input', async (input) => {
		expect(await asSchema(requestHandoff.inputSchema).validate?.(input)).toMatchObject({
			success: false
		});
	});

	it('returns the fallback without a thread id', async () => {
		const runMutation = vi.fn();

		const result = await executeRequestHandoff({ runMutation });

		expect(runMutation).not.toHaveBeenCalled();
		expect(result).toBe(
			"I couldn't reach the team from here. Please send your message again and a human will pick it up."
		);
	});

	it('propagates mutation failures', async () => {
		const error = new Error('mutation failed');
		const runMutation = vi.fn().mockRejectedValue(error);

		await expect(executeRequestHandoff({ threadId: 'thread-1', runMutation })).rejects.toBe(error);
	});
});
