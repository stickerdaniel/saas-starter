import { vi } from 'vitest';
import {
	ChatConversation,
	type AwaitedTurn,
	type ChatSessionPort
} from '../core/chat-session-port.svelte.ts';

/** A complete shared-session double; consumer tests cannot hide missing port members. */
export function createChatSession(threadId: string | null = null) {
	let conversation = new ChatConversation(threadId);
	let awaitedTurn: AwaitedTurn | null = null;
	const session = {
		get conversation() {
			return conversation;
		},
		get threadId() {
			return conversation.threadId;
		},
		get isNewConversation() {
			return conversation.threadId === null;
		},
		isSending: false,
		get isAwaitingStream() {
			return awaitedTurn !== null;
		},
		get awaitedTurn() {
			return awaitedTurn;
		},
		setAwaitingStream(awaiting: boolean) {
			awaitedTurn = awaiting ? { kind: 'unordered' } : null;
		},
		streamCache: {
			getCachedReasoning: vi.fn<(order: number) => string | undefined>(),
			updateReasoningCache: vi.fn<(order: number, reasoning: string) => void>(),
			clearReasoningCache: vi.fn<(order: number) => void>()
		},
		forgetChatSession: vi.fn<() => void>()
	} satisfies ChatSessionPort;
	return Object.assign(session, {
		setThread(next: string | null) {
			conversation = new ChatConversation(next);
		},
		/** Move to `next` the way a surface does: the id-less conversation receives it, any other is replaced. */
		moveTo(next: string | null) {
			if (conversation.threadId === null && next !== null) conversation.assign(next);
			else conversation = new ChatConversation(next);
		}
	});
}
