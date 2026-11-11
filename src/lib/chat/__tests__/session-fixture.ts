import { vi } from 'vitest';
import type { AwaitedTurn, ChatSessionPort } from '../core/chat-session-port';

/** A complete shared-session double; consumer tests cannot hide missing port members. */
export function createChatSession(threadId: string | null = null) {
	let awaitedTurn: AwaitedTurn | null = null;
	return {
		threadId,
		get isNewConversation() {
			return this.threadId === null;
		},
		threadGeneration: 0,
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
		}
	} satisfies ChatSessionPort;
}
