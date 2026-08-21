import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { ChatCore } from './chat-core.svelte.ts';

function makeClient(mutation: ReturnType<typeof vi.fn>): ConvexClient {
	return { mutation } as unknown as ConvexClient;
}

function makeCore() {
	return new ChatCore({
		threadId: 'thread_1',
		api: { sendMessage: 'api.messages.send' as never }
	});
}

describe('ChatCore command outcomes', () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	it('uses a typed code for empty input without calling the backend', async () => {
		const mutation = vi.fn();
		const core = makeCore();

		await expect(core.sendMessage(makeClient(mutation), '   ')).rejects.toMatchObject({
			name: 'ChatCommandError',
			code: 'empty_input'
		});
		expect(core.error).toBe('empty_input');
		expect(mutation).not.toHaveBeenCalled();
	});

	it('distinguishes an in-flight send from empty input', async () => {
		const mutation = vi.fn();
		const core = makeCore();
		core.isSending = true;

		await expect(core.sendMessage(makeClient(mutation), 'hello')).rejects.toMatchObject({
			name: 'ChatCommandError',
			code: 'send_in_progress'
		});
		expect(core.error).toBe('send_in_progress');
		expect(mutation).not.toHaveBeenCalled();
	});

	it('keeps unexpected transport failures throwable and logged', async () => {
		const defect = new Error('transport failed');
		const mutation = vi.fn().mockRejectedValue(defect);
		const core = makeCore();
		let thrown: unknown;

		try {
			await core.sendMessage(makeClient(mutation), 'hello');
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBe(defect);
		expect(core.error).toBe('send_failed');
		expect(errorSpy).toHaveBeenCalledWith('[ChatCore.sendMessage] Failed to send message:', defect);
	});
});
