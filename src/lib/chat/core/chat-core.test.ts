import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { ChatCore, createChatCore } from './chat-core.svelte.ts';

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

	it('supports a state-only session without binding the surface command API', async () => {
		const core = createChatCore({ threadId: 'admin-thread' });
		const mutation = vi.fn();
		core.streamCache.updateReasoningCache(0, 'old reasoning');
		core.setThread('next-thread');
		expect(core.threadId).toBe('next-thread');
		expect(core.streamCache.getCachedReasoning(0)).toBeUndefined();
		core.setAwaitingStream(true);
		expect(core.isAwaitingStream).toBe(true);
		core.setAwaitingStream(false);

		await expect(core.sendMessage(makeClient(mutation), 'hello')).rejects.toThrow(
			'Chat commands are not configured for this session'
		);
		await expect(core.createThread(makeClient(mutation))).rejects.toThrow(
			'createThread API not configured'
		);
		expect(mutation).not.toHaveBeenCalled();
		expect(core.isSending).toBe(false);
		expect(core.isAwaitingStream).toBe(false);
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
		expect(core.isSending).toBe(false);
		expect(core.isAwaitingStream).toBe(false);
		expect(errorSpy).toHaveBeenCalledWith('[ChatCore.sendMessage] Failed to send message:', defect);
	});

	it('clears an earlier failure when a valid retry starts', async () => {
		const defect = new Error('transport failed');
		const mutation = vi
			.fn()
			.mockRejectedValueOnce(defect)
			.mockResolvedValueOnce({ messageId: 'message_1' });
		const core = makeCore();

		await expect(core.sendMessage(makeClient(mutation), 'first')).rejects.toBe(defect);
		expect(core.error).toBe('send_failed');

		await expect(core.sendMessage(makeClient(mutation), 'retry')).resolves.toEqual({
			messageId: 'message_1'
		});
		expect(core.error).toBeNull();
		expect(core.isSending).toBe(false);
		expect(core.isAwaitingStream).toBe(true);
	});

	it('preserves a concurrent refusal after the active send succeeds', async () => {
		let resolveMutation: (result: { messageId: string }) => void = () => undefined;
		const mutation = vi.fn(
			() =>
				new Promise<{ messageId: string }>((resolve) => {
					resolveMutation = resolve;
				})
		);
		const core = makeCore();

		const activeSend = core.sendMessage(makeClient(mutation), 'first');
		await expect(core.sendMessage(makeClient(mutation), 'second')).rejects.toMatchObject({
			name: 'ChatCommandError',
			code: 'send_in_progress'
		});
		expect(core.error).toBe('send_in_progress');

		resolveMutation({ messageId: 'message_1' });
		await expect(activeSend).resolves.toEqual({ messageId: 'message_1' });
		expect(core.error).toBe('send_in_progress');
		expect(core.isSending).toBe(false);
		expect(core.isAwaitingStream).toBe(true);
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it('uses a typed code when lazy thread creation fails', async () => {
		const defect = new Error('thread creation failed');
		const mutation = vi.fn().mockRejectedValue(defect);
		const core = new ChatCore({
			threadId: null,
			api: {
				sendMessage: 'api.messages.send' as never,
				createThread: 'api.threads.create' as never
			}
		});

		await expect(core.sendMessage(makeClient(mutation), 'hello')).rejects.toBe(defect);
		expect(core.error).toBe('create_thread_failed');
		expect(core.isSending).toBe(false);
		expect(core.isAwaitingStream).toBe(false);
	});

	it('uses a typed code when explicit thread creation fails', async () => {
		const defect = new Error('thread creation failed');
		const mutation = vi.fn().mockRejectedValue(defect);
		const core = new ChatCore({
			api: {
				sendMessage: 'api.messages.send' as never,
				createThread: 'api.threads.create' as never
			}
		});

		await expect(core.createThread(makeClient(mutation))).rejects.toBe(defect);
		expect(core.error).toBe('create_thread_failed');
		expect(core.isLoading).toBe(false);
	});
});
