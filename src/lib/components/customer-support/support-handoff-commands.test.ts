import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { SupportConversation } from './support-conversation.svelte.ts';
import { SupportHandoffCommands } from './support-handoff-commands.svelte.ts';
import { SupportNavigationState } from './support-navigation-state.svelte.ts';

function clientWith(mutation: ReturnType<typeof vi.fn>): ConvexClient {
	return { mutation } as unknown as ConvexClient;
}

describe('SupportHandoffCommands', () => {
	let conversation: SupportConversation;
	let commands: SupportHandoffCommands;

	beforeEach(() => {
		conversation = new SupportConversation(new SupportNavigationState());
		commands = new SupportHandoffCommands(conversation);
	});

	it('applies the optimistic handoff and returns a domain outcome', async () => {
		const mutation = vi.fn().mockResolvedValue(undefined);
		conversation.setThread('thread-1');

		await expect(commands.request(clientWith(mutation))).resolves.toEqual({ kind: 'applied' });
		expect(conversation.isHandedOff).toBe(true);
		expect(mutation.mock.calls[0]?.[2]).toEqual(
			expect.objectContaining({ optimisticUpdate: expect.any(Function) })
		);
	});

	it('rolls back the local handoff mirror on mutation failure', async () => {
		conversation.setThread('thread-1');

		await expect(
			commands.request(clientWith(vi.fn().mockRejectedValue(new Error('provider detail'))))
		).resolves.toEqual({ kind: 'failed', code: 'handoff_failed' });
		expect(conversation.isHandedOff).toBe(false);
		expect(conversation.error).toBe('handoff_failed');
	});
});
