import type { StreamStatus } from './types.js';

/**
 * The stream-cache operations consumed by the shared chat presentation layer.
 *
 * Implementations may expose a richer cache API internally; shared UI only
 * receives the operations it needs to reconcile live and persisted messages.
 */
export interface StreamCachePort {
	getCachedReasoning(order: number): string | undefined;
	updateReasoningCache(order: number, reasoning: string): void;
	clearReasoningCache(order: number): void;
	updateStatusCache(order: number, status: StreamStatus): void;
}

/**
 * Consumer-driven state contract for the shared chat UI.
 *
 * AI chat and customer support keep their domain-specific commands and state,
 * while exposing only the session identity and send/stream lifecycle that the
 * reusable composer and message surface consume.
 */
export interface ChatSessionPort {
	readonly threadId: string | null;
	readonly isNewConversation: boolean;
	readonly threadGeneration: number;
	readonly isSending: boolean;
	readonly isAwaitingStream: boolean;
	setAwaitingStream(awaiting: boolean): void;
	readonly streamCache: StreamCachePort;
}
