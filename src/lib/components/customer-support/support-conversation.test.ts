import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import type { ChatSessionPort } from '$lib/chat/core/chat-session-port.js';
import type { ChatCommandError } from '$lib/chat/core/chat-command-error.js';
import { SupportConversation } from './support-conversation.svelte.ts';
import { SupportNavigationState } from './support-navigation-state.svelte.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function clientWith(mutation: ReturnType<typeof vi.fn>): ConvexClient {
	return { mutation } as unknown as ConvexClient;
}

describe('SupportConversation', () => {
	let navigation: SupportNavigationState;
	let conversation: SupportConversation;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		navigation = new SupportNavigationState();
		conversation = new SupportConversation(navigation);
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	it('implements the shared chat session port at compile time', () => {
		const port: ChatSessionPort = conversation;
		expect(port).toBe(conversation);
	});

	it('returns an existing thread without a mutation', async () => {
		const mutation = vi.fn();
		conversation.setThread('thread-existing');

		await expect(conversation.ensureThread(clientWith(mutation))).resolves.toBe('thread-existing');
		expect(mutation).not.toHaveBeenCalled();
	});

	it('shares one warm-thread acquisition across concurrent callers', async () => {
		const warmThread = deferred<{ threadId: string; notificationEmail?: string }>();
		const mutation = vi.fn(() => warmThread.promise);
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);
		conversation.beginNewConversation();
		navigation.startNewThread();
		onThreadChange.mockClear();

		const first = conversation.ensureThread(clientWith(mutation));
		const second = conversation.ensureThread(clientWith(mutation));
		warmThread.resolve({ threadId: 'thread-warm', notificationEmail: 'notify@example.com' });

		await expect(Promise.all([first, second])).resolves.toEqual(['thread-warm', 'thread-warm']);
		expect(mutation).toHaveBeenCalledTimes(1);
		expect(conversation.threadId).toBe('thread-warm');
		expect(conversation.notificationEmail).toBe('notify@example.com');
		expect(conversation.isNewConversation).toBe(true);
		expect(onThreadChange).toHaveBeenCalledOnce();
		expect(onThreadChange).toHaveBeenCalledWith('thread-warm');
	});

	it('clears a failed acquisition so a later call can retry', async () => {
		const mutation = vi
			.fn()
			.mockRejectedValueOnce(new Error('temporary'))
			.mockResolvedValueOnce({ threadId: 'thread-retry' });
		conversation.beginNewConversation();
		navigation.startNewThread();
		const client = clientWith(mutation);

		await expect(conversation.ensureThread(client)).rejects.toThrow('temporary');
		await expect(conversation.ensureThread(client)).resolves.toBe('thread-retry');
		expect(mutation).toHaveBeenCalledTimes(2);
		expect(conversation.threadId).toBe('thread-retry');
	});

	it('ignores a warm completion after navigation leaves the chat view', async () => {
		const warmThread = deferred<{ threadId: string }>();
		const mutation = vi.fn(() => warmThread.promise);
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);
		conversation.beginNewConversation();
		navigation.startNewThread();
		onThreadChange.mockClear();

		const acquisition = conversation.ensureThread(clientWith(mutation));
		navigation.goBack();
		onThreadChange.mockClear();
		warmThread.resolve({ threadId: 'thread-stale' });

		await expect(acquisition).resolves.toBe('thread-stale');
		expect(conversation.threadId).toBeNull();
		expect(onThreadChange).not.toHaveBeenCalled();
	});

	it('starts an independent acquisition for a newer compose session', async () => {
		const oldWarmThread = deferred<{ threadId: string }>();
		const mutation = vi
			.fn()
			.mockImplementationOnce(() => oldWarmThread.promise)
			.mockResolvedValueOnce({ threadId: 'thread-new-session' });
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);
		conversation.beginNewConversation();
		navigation.startNewThread();
		const oldAcquisition = conversation.ensureThread(clientWith(mutation));

		conversation.beginNewConversation();
		navigation.startNewThread();
		onThreadChange.mockClear();
		const newAcquisition = conversation.ensureThread(clientWith(mutation));

		await expect(newAcquisition).resolves.toBe('thread-new-session');
		oldWarmThread.resolve({ threadId: 'thread-old-session' });
		await expect(oldAcquisition).resolves.toBe('thread-old-session');
		expect(mutation).toHaveBeenCalledTimes(2);
		expect(conversation.threadId).toBe('thread-new-session');
		expect(onThreadChange).toHaveBeenCalledOnce();
		expect(onThreadChange).toHaveBeenCalledWith('thread-new-session');
	});

	it('ignores a warm completion from an older compose session', async () => {
		const warmThread = deferred<{ threadId: string }>();
		const mutation = vi.fn(() => warmThread.promise);
		const onThreadChange = vi.fn();
		navigation.setOnThreadChange(onThreadChange);
		conversation.beginNewConversation();
		navigation.startNewThread();
		onThreadChange.mockClear();

		const acquisition = conversation.ensureThread(clientWith(mutation));
		conversation.beginNewConversation();
		navigation.startNewThread();
		onThreadChange.mockClear();
		warmThread.resolve({ threadId: 'thread-old-session' });

		await expect(acquisition).resolves.toBe('thread-old-session');
		expect(conversation.threadId).toBeNull();
		expect(onThreadChange).not.toHaveBeenCalled();
	});

	it('retries a failed eager warm-up within the active send command', async () => {
		const warmThread = deferred<{ threadId: string }>();
		const mutation = vi
			.fn()
			.mockImplementationOnce(() => warmThread.promise)
			.mockResolvedValueOnce({ threadId: 'thread-retry' })
			.mockResolvedValueOnce(undefined);
		conversation.beginNewConversation();
		navigation.startNewThread();
		const client = clientWith(mutation);
		const warmup = conversation.ensureThread(client);
		const warmupFailure = expect(warmup).rejects.toThrow('temporary');
		const send = conversation.sendMessage(client, 'hello');

		warmThread.reject(new Error('temporary'));

		await warmupFailure;
		await expect(send).resolves.toEqual({ threadId: 'thread-retry', threadCreated: true });
		expect(mutation).toHaveBeenCalledTimes(3);
	});

	it('keeps loaded metadata while adopting a URL-selected identity', () => {
		conversation.setThread(
			'thread-1',
			'Kai',
			true,
			{ name: 'Admin', image: null },
			'notify@example.com'
		);

		conversation.selectThreadFromUrl('thread-2');

		expect(conversation.threadId).toBe('thread-2');
		expect(conversation.threadAgentName).toBe('Kai');
		expect(conversation.isHandedOff).toBe(true);
		expect(conversation.notificationEmail).toBe('notify@example.com');
	});

	it('retains same-thread send locks and clears cross-thread locks', () => {
		conversation.setThread('thread-1');
		conversation.setSending(true);
		conversation.setAwaitingStream(true);

		conversation.setThread('thread-1');
		expect(conversation.isSending).toBe(true);
		expect(conversation.isAwaitingStream).toBe(true);

		conversation.setThread('thread-2');
		expect(conversation.isSending).toBe(false);
		expect(conversation.isAwaitingStream).toBe(false);
	});

	it('blocks an additional AI send while a reply is pending', async () => {
		conversation.setThread('thread-1');
		conversation.setAwaitingStream(true);

		await expect(conversation.sendMessage(clientWith(vi.fn()), 'hello')).rejects.toMatchObject({
			code: 'send_in_progress'
		} satisfies Partial<ChatCommandError>);
	});

	it('rejects empty input before calling the mutation', async () => {
		const mutation = vi.fn();
		conversation.setThread('thread-1');

		await expect(conversation.sendMessage(clientWith(mutation), '   ')).rejects.toMatchObject({
			code: 'empty_input'
		} satisfies Partial<ChatCommandError>);
		expect(mutation).not.toHaveBeenCalled();
	});

	it('allows human-only fire-and-forget sends after each mutation', async () => {
		const mutation = vi.fn().mockResolvedValue(undefined);
		conversation.setThread('thread-1');
		conversation.setHandedOff(true);
		conversation.setSending(true);

		await expect(conversation.sendMessage(clientWith(mutation), 'hello')).resolves.toEqual({
			threadId: 'thread-1',
			threadCreated: false
		});
		expect(mutation).toHaveBeenCalledOnce();
		expect(conversation.isSending).toBe(false);
		expect(conversation.isAwaitingStream).toBe(false);
	});

	it('moves a successful AI send into awaiting-stream state', async () => {
		const mutation = vi.fn().mockResolvedValue(undefined);
		conversation.setThread('thread-1');

		await conversation.sendMessage(clientWith(mutation), 'hello');

		expect(conversation.isSending).toBe(false);
		expect(conversation.isAwaitingStream).toBe(true);
	});

	it.each(['resolve', 'reject'] as const)(
		'keeps a stale thread A send from changing thread B after it %s',
		async (outcome) => {
			const threadA = deferred<void>();
			const mutation = vi
				.fn()
				.mockImplementationOnce(() => threadA.promise)
				.mockResolvedValueOnce(undefined);
			const client = clientWith(mutation);
			conversation.setThread('thread-a');

			const sendA = conversation.sendMessage(client, 'from A');
			expect(conversation.isSending).toBe(true);

			conversation.setThread('thread-b');
			expect(conversation.isSending).toBe(false);
			expect(conversation.isAwaitingStream).toBe(false);
			await expect(conversation.sendMessage(client, 'from B')).resolves.toEqual({
				threadId: 'thread-b',
				threadCreated: false
			});
			expect(conversation.isAwaitingStream).toBe(true);

			const defect = new Error('thread A provider detail');
			if (outcome === 'resolve') {
				threadA.resolve();
				await expect(sendA).resolves.toEqual({ threadId: 'thread-a', threadCreated: false });
			} else {
				threadA.reject(defect);
				await expect(sendA).rejects.toBe(defect);
			}

			expect(conversation.threadId).toBe('thread-b');
			expect(conversation.error).toBeNull();
			expect(conversation.isSending).toBe(false);
			expect(conversation.isAwaitingStream).toBe(true);
			expect(errorSpy).not.toHaveBeenCalled();
		}
	);

	it('keeps unexpected send failures throwable while storing only a stable code', async () => {
		const defect = new Error('provider transport detail');
		const mutation = vi.fn().mockRejectedValue(defect);
		conversation.setThread('thread-1');

		await expect(conversation.sendMessage(clientWith(mutation), 'hello')).rejects.toBe(defect);
		expect(conversation.error).toBe('send_failed');
		expect(errorSpy).toHaveBeenCalledExactlyOnceWith('[SupportConversation.sendMessage] Failed');
		expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), defect);
		expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(defect.message);
	});
});
