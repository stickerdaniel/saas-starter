import { vi } from 'vitest';
import type { ChatSessionPort } from '../core/chat-session-port';

/** A complete shared-session double; consumer tests cannot hide missing port members. */
export function createChatSession(threadId: string | null = null) {
	let awaitingStream = false;
	return {
		threadId,
		get isNewConversation() {
			return this.threadId === null;
		},
		threadGeneration: 0,
		isSending: false,
		get isAwaitingStream() {
			return awaitingStream;
		},
		setAwaitingStream(awaiting: boolean) {
			awaitingStream = awaiting;
		},
		streamCache: {
			getCachedReasoning: vi.fn<(order: number) => string | undefined>(),
			updateReasoningCache: vi.fn<(order: number, reasoning: string) => void>(),
			clearReasoningCache: vi.fn<(order: number) => void>(),
			updateStatusCache: vi.fn<ChatSessionPort['streamCache']['updateStatusCache']>()
		}
	} satisfies ChatSessionPort;
}
