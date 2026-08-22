import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import type { ChatSessionPort } from '$lib/chat/core/chat-session-port.js';
import { SupportThreadContext } from './support-thread-context.svelte.ts';

function makeClient(mutation: ReturnType<typeof vi.fn>): ConvexClient {
	return { mutation } as unknown as ConvexClient;
}

describe('SupportThreadContext command outcomes', () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		localStorage.clear();
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	it('returns a missing-thread handoff outcome without mutating', async () => {
		const mutation = vi.fn();
		const context = new SupportThreadContext();

		await expect(context.requestHandoff(makeClient(mutation))).resolves.toEqual({
			kind: 'missing_thread'
		});
		expect(context.isHandedOff).toBe(false);
		expect(mutation).not.toHaveBeenCalled();
	});

	it('returns applied and supplies an optimistic update for handoff', async () => {
		const mutation = vi.fn().mockResolvedValue(null);
		const context = new SupportThreadContext();
		context.threadId = 'thread_1';

		await expect(context.requestHandoff(makeClient(mutation))).resolves.toEqual({
			kind: 'applied'
		});
		expect(context.isHandedOff).toBe(true);
		expect(mutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ threadId: 'thread_1' }),
			expect.objectContaining({ optimisticUpdate: expect.any(Function) })
		);
	});

	it('rolls back the local handoff mirror and returns a stable failure code', async () => {
		const defect = new Error('raw mutation detail');
		const mutation = vi.fn().mockRejectedValue(defect);
		const context = new SupportThreadContext();
		context.threadId = 'thread_1';

		await expect(context.requestHandoff(makeClient(mutation))).resolves.toEqual({
			kind: 'failed',
			code: 'handoff_failed'
		});
		expect(context.isHandedOff).toBe(false);
		expect(context.error).toBe('handoff_failed');
		expect(errorSpy).toHaveBeenCalledWith('[requestHandoff] Failed:', defect);
	});

	it('returns the normalized saved email and clears pending state', async () => {
		const mutation = vi.fn().mockResolvedValue(null);
		const context = new SupportThreadContext();
		context.threadId = 'thread_1';

		await expect(
			context.setNotificationEmail(makeClient(mutation), ' USER@example.com ')
		).resolves.toEqual({ kind: 'saved', email: 'user@example.com' });
		expect(context.notificationEmail).toBe('user@example.com');
		expect(context.isEmailPending).toBe(false);
		expect(mutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ threadId: 'thread_1', email: 'user@example.com' }),
			expect.objectContaining({ optimisticUpdate: expect.any(Function) })
		);
	});

	it('returns a stable notification failure without exposing the raw cause', async () => {
		const defect = new Error('raw mutation detail');
		const mutation = vi.fn().mockRejectedValue(defect);
		const context = new SupportThreadContext();
		context.threadId = 'thread_1';
		context.notificationEmail = 'old@example.com';

		await expect(
			context.setNotificationEmail(makeClient(mutation), 'new@example.com')
		).resolves.toEqual({ kind: 'failed', code: 'notification_update_failed' });
		expect(context.notificationEmail).toBe('old@example.com');
		expect(context.error).toBe('notification_update_failed');
		expect(context.isEmailPending).toBe(false);
		expect(errorSpy).toHaveBeenCalledWith('[setNotificationEmail] Failed:', defect);
	});

	it('uses typed validation codes before sending a message', async () => {
		const mutation = vi.fn();
		const context = new SupportThreadContext();
		context.threadId = 'thread_1';

		await expect(context.sendMessage(makeClient(mutation), '   ')).rejects.toMatchObject({
			name: 'ChatCommandError',
			code: 'empty_input'
		});

		context.isSending = true;
		await expect(context.sendMessage(makeClient(mutation), 'hello')).rejects.toMatchObject({
			name: 'ChatCommandError',
			code: 'send_in_progress'
		});
		expect(mutation).not.toHaveBeenCalled();
	});

	it('keeps unexpected send failures throwable while storing only a stable code', async () => {
		const defect = new Error('provider transport detail');
		const mutation = vi.fn().mockRejectedValue(defect);
		const context = new SupportThreadContext();
		context.threadId = 'thread_1';
		let thrown: unknown;

		try {
			await context.sendMessage(makeClient(mutation), 'hello');
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBe(defect);
		expect(context.error).toBe('send_failed');
		expect(errorSpy).toHaveBeenCalledWith('[sendMessage] Failed:', defect);
	});
});

describe('SupportThreadContext compatibility facade', () => {
	it('forwards current call sites to the owned collaborators', () => {
		const context = new SupportThreadContext();

		context.setUserId('anonymous:test');
		context.setThread('thread-1', 'Kai', true, { name: 'Admin', image: null }, 'mail@example.com');
		context.currentView = 'chat';
		context.skipAnimation = true;

		expect(context.userId).toBe(context.conversation.userId);
		expect(context.threadId).toBe(context.conversation.threadId);
		expect(context.isHandedOff).toBe(context.conversation.isHandedOff);
		expect(context.notificationEmail).toBe(context.conversation.notificationEmail);
		expect(context.currentView).toBe(context.navigation.currentView);
		expect(context.skipAnimation).toBe(context.navigation.skipAnimation);
	});

	it('keeps one root while exposing the narrow shared-chat implementation', () => {
		const context = new SupportThreadContext();
		const session: ChatSessionPort = context.conversation;

		expect(session).toBe(context.conversation);
		expect(context.navigation).toBeDefined();
		expect(context.handoff).toBeDefined();
		expect(context.notifications).toBeDefined();
	});

	it('does not adopt a warm thread after the widget leaves and re-enters chat', async () => {
		let resolveWarmThread!: (value: { threadId: string }) => void;
		const warmThread = new Promise<{ threadId: string }>((resolve) => {
			resolveWarmThread = resolve;
		});
		const mutation = vi.fn(() => warmThread);
		const client = { mutation } as unknown as ConvexClient;
		const context = new SupportThreadContext();
		context.setClient(client);
		context.startNewThread();
		const acquisition = context.ensureThread(client);

		context.currentView = 'overview';
		context.currentView = 'chat';
		resolveWarmThread({ threadId: 'thread-stale-navigation' });

		await expect(acquisition).resolves.toBe('thread-stale-navigation');
		expect(context.threadId).toBeNull();
	});

	it('increments generation for distinct null compose sessions', () => {
		const context = new SupportThreadContext();

		context.startNewThread();
		const firstGeneration = context.threadGeneration;
		context.goBack();
		context.startNewThread();

		expect(context.threadId).toBeNull();
		expect(context.threadGeneration).toBe(firstGeneration + 1);
		expect(context.isNewConversation).toBe(true);
	});
});
