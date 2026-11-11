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
}

/**
 * The response a sent prompt waits on, which decides what settles the wait.
 *
 * - `unaccepted`: the send has not returned yet, so no response can be matched
 *   to the prompt and nothing settles it.
 * - `accepted`: the backend saved the prompt at `order`. Its reply, stream or
 *   terminal notice lands at that same order, so only an assistant message
 *   there settles it; a reply to an older prompt does not.
 * - `unordered`: the surface's send reports no order. Any assistant response
 *   that starts after the prompt settles it.
 */
export type AwaitedTurn =
	| { readonly kind: 'unaccepted' }
	| { readonly kind: 'accepted'; readonly order: number }
	| { readonly kind: 'unordered' };

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
	/** True exactly while `awaitedTurn` is set. */
	readonly isAwaitingStream: boolean;
	/** The response the last send waits on; null when nothing is awaited. */
	readonly awaitedTurn: AwaitedTurn | null;
	/** `false` settles the awaited turn; `true` starts the surface's own kind of wait. */
	setAwaitingStream(awaiting: boolean): void;
	readonly streamCache: StreamCachePort;
}
