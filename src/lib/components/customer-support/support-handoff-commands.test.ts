import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		conversation = new SupportConversation(new SupportNavigationState());
		commands = new SupportHandoffCommands(conversation);
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	it('reports a missing thread without calling the mutation', async () => {
		const mutation = vi.fn();

		await expect(commands.request(clientWith(mutation))).resolves.toEqual({
			kind: 'missing_thread'
		});
		expect(mutation).not.toHaveBeenCalled();
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
		const defect = new Error('provider detail');
		conversation.setThread('thread-1');

		await expect(commands.request(clientWith(vi.fn().mockRejectedValue(defect)))).resolves.toEqual({
			kind: 'failed',
			code: 'handoff_failed'
		});
		expect(conversation.isHandedOff).toBe(false);
		expect(conversation.error).toBe('handoff_failed');
		expect(errorSpy).toHaveBeenCalledWith('[requestHandoff] Failed:', defect);
	});
});
