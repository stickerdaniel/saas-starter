import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { SupportConversation } from './support-conversation.svelte.ts';
import { SupportNavigationState } from './support-navigation-state.svelte.ts';
import { SupportNotificationCommands } from './support-notification-commands.svelte.ts';

function clientWith(mutation: ReturnType<typeof vi.fn>): ConvexClient {
	return { mutation } as unknown as ConvexClient;
}

describe('SupportNotificationCommands', () => {
	let conversation: SupportConversation;
	let commands: SupportNotificationCommands;

	beforeEach(() => {
		conversation = new SupportConversation(new SupportNavigationState());
		commands = new SupportNotificationCommands(conversation);
	});

	it('normalizes and saves the email after applying an optimistic query update', async () => {
		conversation.setThread('thread-1');
		const setQuery = vi.fn();
		const store = {
			getQuery: vi.fn().mockReturnValue({ _id: 'thread-1', notificationEmail: undefined }),
			setQuery
		};
		const mutation = vi.fn(async (_function, _args, options) => {
			expect(commands.isPending).toBe(true);
			options.optimisticUpdate(store);
		});

		await expect(commands.setEmail(clientWith(mutation), ' USER@Example.COM ')).resolves.toEqual({
			kind: 'saved',
			email: 'user@example.com'
		});
		expect(setQuery).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ notificationEmail: 'user@example.com' })
		);
		expect(conversation.notificationEmail).toBe('user@example.com');
		expect(commands.isPending).toBe(false);
	});

	it('retains the confirmed email and returns a stable code on failure', async () => {
		conversation.setThread('thread-1', undefined, false, undefined, 'old@example.com');

		await expect(
			commands.setEmail(
				clientWith(vi.fn().mockRejectedValue(new Error('raw provider message'))),
				'new@example.com'
			)
		).resolves.toEqual({ kind: 'failed', code: 'notification_update_failed' });
		expect(conversation.notificationEmail).toBe('old@example.com');
		expect(conversation.error).toBe('notification_update_failed');
		expect(commands.isPending).toBe(false);
	});

	it('reports a missing thread without entering pending state', async () => {
		await expect(commands.setEmail(clientWith(vi.fn()), 'user@example.com')).resolves.toEqual({
			kind: 'missing_thread'
		});
		expect(commands.isPending).toBe(false);
	});
});
