// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import { ChatConversation } from '../core/chat-session-port.svelte.ts';
import { chatComposerFor } from './chat-composer.svelte.ts';

describe('composers in a server render', () => {
	it('gives every render its own composer and registers none of them', () => {
		const first = chatComposerFor('ai-chat');
		const second = chatComposerFor('ai-chat');
		const forget = vi.spyOn(first, 'forgetPersistedState');

		expect(second).not.toBe(first);
		const conversation = new ChatConversation('thread-a');
		first.edit(conversation, 'first render');
		expect(second.textOf(conversation)).toBe('');
		clearPersistedChatState();
		expect(forget).not.toHaveBeenCalled();
	});
});
