// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { clearPersistedChatState } from '../core/chat-persisted-state.ts';
import { ChatConversation } from '../core/chat-session-port.svelte.ts';
import { acquireChatComposer } from './chat-composer.svelte.ts';

describe('composers in a server render', () => {
	it('gives every render its own composer and registers none of them', () => {
		const first = acquireChatComposer('ai-chat');
		const second = acquireChatComposer('ai-chat');
		const forget = vi.spyOn(first.owner, 'forgetPersistedState');

		expect(second.owner).not.toBe(first.owner);
		const conversation = new ChatConversation('thread-a');
		first.owner.edit(conversation, 'first render');
		expect(second.owner.textOf(conversation)).toBe('');
		clearPersistedChatState();
		expect(forget).not.toHaveBeenCalled();
		first.release();
		second.release();
	});
});
