import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { ChatCore, createChatCore } from './chat-core.svelte.ts';
import { clearPersistedChatState } from './chat-persisted-state.ts';
import type { ChatSessionPort } from './chat-session-port.svelte.ts';

function makeClient(mutation: ReturnType<typeof vi.fn>): ConvexClient {
	return { mutation } as unknown as ConvexClient;
}

function deferred<T>() {
	return Promise.withResolvers<T>();
}

function makeLazyCore() {
	return new ChatCore({
		threadId: null,
		api: {
			sendMessage: 'api.messages.send' as never,
			createThread: 'api.threads.create' as never
		}
	});
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
		expect(errorSpy).toHaveBeenCalledExactlyOnceWith('[ChatCore.sendMessage] Failed');
		expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), defect);
		expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(defect.message);
	});

	it('clears an earlier failure when a valid retry starts', async () => {
		const defect = new Error('transport failed');
		const mutation = vi
			.fn()
			.mockRejectedValueOnce(defect)
			.mockResolvedValueOnce({ messageId: 'message_1', order: 1 });
		const core = makeCore();

		await expect(core.sendMessage(makeClient(mutation), 'first')).rejects.toBe(defect);
		expect(core.error).toBe('send_failed');

		await expect(core.sendMessage(makeClient(mutation), 'retry')).resolves.toEqual({
			messageId: 'message_1',
			order: 1
		});
		expect(core.error).toBeNull();
		expect(core.isSending).toBe(false);
		expect(core.isAwaitingStream).toBe(true);
	});

	it("waits on no response until the backend returns the prompt's order", async () => {
		const accepted = deferred<{ messageId: string; order: number }>();
		const core = makeCore();

		const send = core.sendMessage(makeClient(vi.fn(() => accepted.promise)), 'hello');
		expect(core.awaitedTurn).toEqual({ kind: 'unaccepted' });

		accepted.resolve({ messageId: 'message_1', order: 7 });
		await send;
		expect(core.awaitedTurn).toEqual({ kind: 'accepted', order: 7 });
	});

	it('preserves a concurrent refusal after the active send succeeds', async () => {
		let resolveMutation: (result: { messageId: string; order: number }) => void = () => undefined;
		const mutation = vi.fn(
			() =>
				new Promise<{ messageId: string; order: number }>((resolve) => {
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

		resolveMutation({ messageId: 'message_1', order: 1 });
		await expect(activeSend).resolves.toEqual({ messageId: 'message_1', order: 1 });
		expect(core.error).toBe('send_in_progress');
		expect(core.isSending).toBe(false);
		expect(core.isAwaitingStream).toBe(true);
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it.each(['resolve', 'reject'] as const)(
		'keeps a stale thread A send from changing thread B after it %s',
		async (outcome) => {
			const threadA = deferred<{ messageId: string; order: number }>();
			const mutation = vi
				.fn()
				.mockImplementationOnce(() => threadA.promise)
				.mockResolvedValueOnce({ messageId: 'message_b', order: 4 });
			const core = makeCore();
			const client = makeClient(mutation);

			const sendA = core.sendMessage(client, 'from A');
			expect(core.isSending).toBe(true);
			expect(core.isAwaitingStream).toBe(true);

			core.setThread('thread_b');
			expect(core.isSending).toBe(false);
			expect(core.isAwaitingStream).toBe(false);

			await expect(core.sendMessage(client, 'from B')).resolves.toEqual({
				messageId: 'message_b',
				order: 4
			});
			expect(mutation.mock.calls[1]?.[1]).toMatchObject({ threadId: 'thread_b' });
			expect(core.isSending).toBe(false);
			expect(core.isAwaitingStream).toBe(true);

			const defect = new Error('thread A provider detail');
			if (outcome === 'resolve') {
				threadA.resolve({ messageId: 'message_a', order: 2 });
				await expect(sendA).resolves.toEqual({ messageId: 'message_a', order: 2 });
			} else {
				threadA.reject(defect);
				await expect(sendA).rejects.toBe(defect);
			}

			expect(core.threadId).toBe('thread_b');
			expect(core.error).toBeNull();
			expect(core.isSending).toBe(false);
			expect(core.awaitedTurn).toEqual({ kind: 'accepted', order: 4 });
			expect(errorSpy).not.toHaveBeenCalled();
		}
	);

	it('keeps the send lock when the created thread is set again during creation', async () => {
		const message = deferred<{ messageId: string; order: number }>();
		const mutation = vi
			.fn()
			.mockResolvedValueOnce({ threadId: 'thread_created' })
			.mockImplementationOnce(() => message.promise);
		const core = new ChatCore({
			threadId: null,
			api: {
				sendMessage: 'api.messages.send' as never,
				createThread: 'api.threads.create' as never
			}
		});
		core.conversation.whenAssigned((threadId) => core.setThread(threadId));

		const send = core.sendMessage(makeClient(mutation), 'hello');
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));

		expect(core.threadId).toBe('thread_created');
		expect(core.isSending).toBe(true);
		expect(core.isAwaitingStream).toBe(true);
		message.resolve({ messageId: 'message_1', order: 0 });
		await expect(send).resolves.toMatchObject({ messageId: 'message_1' });
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

	it('keeps a reply seen during a pending send settled when the send resolves', async () => {
		const accepted = deferred<{ messageId: string; order: number }>();
		const core = makeCore();

		const send = core.sendMessage(makeClient(vi.fn(() => accepted.promise)), 'hello');
		core.setAwaitingStream(false);
		expect(core.awaitedTurn).toBeNull();
		expect(core.isSending).toBe(true);

		accepted.resolve({ messageId: 'message_1', order: 3 });
		await expect(send).resolves.toEqual({ messageId: 'message_1', order: 3 });
		expect(core.awaitedTurn).toBeNull();
		expect(core.isSending).toBe(false);
	});

	it('waits on a stream without a send', () => {
		const core = makeCore();

		core.setAwaitingStream(true);
		expect(core.awaitedTurn).toEqual({ kind: 'unaccepted' });
		expect(core.isSending).toBe(false);

		core.setAwaitingStream(false);
		expect(core.awaitedTurn).toBeNull();
	});

	it('refuses a send while a caller locks the composer and sends after unlock', async () => {
		const mutation = vi.fn().mockResolvedValue({ messageId: 'message_1', order: 1 });
		const core = makeCore();

		core.setSending(true);
		await expect(core.sendMessage(makeClient(mutation), 'hello')).rejects.toMatchObject({
			code: 'send_in_progress'
		});
		expect(mutation).not.toHaveBeenCalled();

		core.setSending(false);
		await expect(core.sendMessage(makeClient(mutation), 'hello')).resolves.toEqual({
			messageId: 'message_1',
			order: 1
		});
		expect(mutation).toHaveBeenCalledOnce();
	});

	it('ends a send whose thread creation another thread superseded', async () => {
		const created = deferred<{ threadId: string }>();
		const mutation = vi.fn().mockImplementationOnce(() => created.promise);
		const core = makeLazyCore();

		const send = core.sendMessage(makeClient(mutation), 'hello');
		core.setThread('other');
		created.resolve({ threadId: 'thread_created' });

		await expect(send).rejects.toThrow(new Error('Chat session ended'));
		expect(mutation).toHaveBeenCalledOnce();
		expect(core.threadId).toBe('other');
		expect(core.error).toBeNull();
		expect(core.isSending).toBe(false);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it.each([
		['thread creation', 'owned'],
		['thread creation', 'stale'],
		['send', 'owned'],
		['send', 'stale']
	] as const)('rejects with the %s error itself when %s', async (path, ownership) => {
		const defect = new Error(`${path} failed`);
		const pending = deferred<never>();
		const mutation =
			path === 'send'
				? vi.fn(() => pending.promise)
				: vi.fn().mockImplementationOnce(() => pending.promise);
		const core = path === 'send' ? makeCore() : makeLazyCore();

		const send = core.sendMessage(makeClient(mutation), 'hello');
		if (ownership === 'stale') core.setThread('other');
		pending.reject(defect);

		await expect(send).rejects.toBe(defect);
		expect(core.error).toBe(
			ownership === 'stale' ? null : path === 'send' ? 'send_failed' : 'create_thread_failed'
		);
		expect(core.isSending).toBe(false);
	});

	it('keeps the session port surface with a writable isSending', () => {
		const core = makeCore();
		const port: ChatSessionPort = core;

		core.isSending = true;
		expect(port.isSending).toBe(true);
		core.isSending = false;
		expect(port.isSending).toBe(false);
	});

	it('keeps the created thread when its listener unlocks the composer first', async () => {
		const message = deferred<{ messageId: string; order: number }>();
		const mutation = vi
			.fn()
			.mockResolvedValueOnce({ threadId: 'thread_created' })
			.mockImplementationOnce(() => message.promise);
		const core = makeLazyCore();
		core.conversation.whenAssigned((threadId) => {
			core.isSending = false;
			core.setThread(threadId);
		});

		const send = core.sendMessage(makeClient(mutation), 'hello');
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
		expect(mutation.mock.calls[1]?.[1]).toMatchObject({ threadId: 'thread_created' });

		message.resolve({ messageId: 'message_1', order: 5 });
		await expect(send).resolves.toEqual({
			messageId: 'message_1',
			order: 5,
			threadCreated: { threadId: 'thread_created' }
		});
		expect(core.awaitedTurn).toEqual({ kind: 'accepted', order: 5 });
		expect(core.isSending).toBe(false);
	});

	it('sends to the created thread when its listener selects another thread', async () => {
		const message = deferred<{ messageId: string; order: number }>();
		const mutation = vi
			.fn()
			.mockResolvedValueOnce({ threadId: 'thread_created' })
			.mockImplementationOnce(() => message.promise);
		const core = makeLazyCore();
		core.conversation.whenAssigned(() => core.setThread('unrelated'));

		const send = core.sendMessage(makeClient(mutation), 'hello');
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
		expect(mutation.mock.calls[1]?.[1]).toMatchObject({ threadId: 'thread_created' });
		expect(core.isSending).toBe(false);
		expect(core.awaitedTurn).toBeNull();
		expect(core.threadId).toBe('unrelated');

		message.resolve({ messageId: 'message_1', order: 5 });
		await expect(send).resolves.toEqual({
			messageId: 'message_1',
			order: 5,
			threadCreated: { threadId: 'thread_created' }
		});
		expect(core.threadId).toBe('unrelated');
		expect(core.error).toBeNull();
		expect(core.awaitedTurn).toBeNull();
	});

	it('fails a send whose conversation received a thread from outside meanwhile', async () => {
		const created = deferred<{ threadId: string }>();
		const mutation = vi.fn().mockImplementationOnce(() => created.promise);
		const core = makeLazyCore();

		const send = core.sendMessage(makeClient(mutation), 'hello');
		core.conversation.assign('thread_route');
		created.resolve({ threadId: 'thread_created' });

		await expect(send).rejects.toThrow('Chat conversation has a thread id already');
		expect(mutation).toHaveBeenCalledOnce();
		expect(core.threadId).toBe('thread_route');
		expect(core.error).toBe('create_thread_failed');
		expect(core.isSending).toBe(false);
	});

	it('settles a send whose transport throws before the call returns', async () => {
		const defect = new Error('transport threw');
		const core = makeCore();

		const send = core.sendMessage(
			makeClient(
				vi.fn(() => {
					throw defect;
				})
			),
			'hello'
		);
		clearPersistedChatState();

		expect(core.isSending).toBe(false);
		expect(core.error).toBe('send_failed');
		await expect(send).rejects.toBe(defect);
	});

	it.each([0, 1, 2, 3, 4])(
		'leaves a thread selected %i microtasks after the send resolves untouched',
		async (ticks) => {
			const accepted = deferred<{ messageId: string; order: number }>();
			const core = makeCore();

			const send = core.sendMessage(makeClient(vi.fn(() => accepted.promise)), 'hello');
			accepted.resolve({ messageId: 'message_1', order: 7 });
			for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
			core.setThread('other');

			await expect(send).resolves.toEqual({ messageId: 'message_1', order: 7 });
			expect(core.threadId).toBe('other');
			expect(core.awaitedTurn).toBeNull();
			expect(core.isSending).toBe(false);
			expect(core.shouldOpenWidget).toBe(false);
		}
	);
});
