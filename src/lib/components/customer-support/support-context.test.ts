import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import type { ChatSessionPort } from '$lib/chat/core/chat-session-port.js';
import { SupportContext } from './support-context.svelte.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function clientWith(mutation: ReturnType<typeof vi.fn>): ConvexClient {
	return { mutation } as unknown as ConvexClient;
}

describe('SupportContext', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('exposes one composed graph with the conversation as the shared chat port', () => {
		const support = new SupportContext();
		const session: ChatSessionPort = support.conversation;

		expect(session).toBe(support.conversation);
		expect(support.navigation).toBeDefined();
		expect(support.handoff).toBeDefined();
		expect(support.notifications).toBeDefined();
	});

	it('coordinates thread selection across conversation and navigation', () => {
		const support = new SupportContext();
		const onThreadChange = vi.fn();
		support.navigation.setOnThreadChange(onThreadChange);

		support.selectThread(
			'thread-1',
			'Kai',
			true,
			{ name: 'Admin', image: null },
			'mail@example.com'
		);

		expect(support.conversation.threadId).toBe('thread-1');
		expect(support.conversation.threadAgentName).toBe('Kai');
		expect(support.conversation.isHandedOff).toBe(true);
		expect(support.conversation.notificationEmail).toBe('mail@example.com');
		expect(support.conversation.isNewConversation).toBe(false);
		expect(support.navigation.currentView).toBe('chat');
		expect(onThreadChange).toHaveBeenCalledWith('thread-1');
	});

	it('adopts a URL-selected identity without echoing the URL callback', () => {
		const support = new SupportContext();
		const onThreadChange = vi.fn();
		support.navigation.setOnThreadChange(onThreadChange);
		support.conversation.setThread(
			'thread-old',
			'Kai',
			true,
			{ name: 'Admin', image: null },
			'mail@example.com'
		);

		support.selectThreadFromUrl('thread-url');

		expect(support.conversation.threadId).toBe('thread-url');
		expect(support.conversation.threadAgentName).toBe('Kai');
		expect(support.conversation.isHandedOff).toBe(true);
		expect(support.conversation.notificationEmail).toBe('mail@example.com');
		expect(support.navigation.currentView).toBe('chat');
		expect(support.navigation.skipAnimation).toBe(true);
		expect(onThreadChange).not.toHaveBeenCalled();
	});

	it('opens the widget on an established conversation', () => {
		const support = new SupportContext();

		support.requestWidgetOpen();
		expect(support.navigation.shouldOpenWidget).toBe(true);
		expect(support.navigation.currentView).toBe('overview');

		support.navigation.clearWidgetOpenRequest();
		support.conversation.setThread('thread-1');
		support.requestWidgetOpen();
		expect(support.navigation.shouldOpenWidget).toBe(true);
		expect(support.navigation.currentView).toBe('chat');
	});

	it('does not adopt a warm thread after leaving and re-entering chat', async () => {
		const warmThread = deferred<{ threadId: string }>();
		const mutation = vi.fn(() => warmThread.promise);
		const client = clientWith(mutation);
		const support = new SupportContext();
		support.conversation.setClient(client);
		support.startNewThread();
		const acquisition = support.conversation.ensureThread(client);

		support.goBack();
		support.navigation.showChat();
		warmThread.resolve({ threadId: 'thread-stale-navigation' });

		await expect(acquisition).resolves.toBe('thread-stale-navigation');
		expect(support.conversation.threadId).toBeNull();
	});

	it('increments generation for distinct null compose sessions', () => {
		const support = new SupportContext();

		support.startNewThread();
		const firstGeneration = support.conversation.threadGeneration;
		support.goBack();
		support.startNewThread();

		expect(support.conversation.threadId).toBeNull();
		expect(support.conversation.threadGeneration).toBe(firstGeneration + 1);
		expect(support.conversation.isNewConversation).toBe(true);
	});
});
