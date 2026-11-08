/**
 * Reasoning text per message order, kept while a stream hands over to the
 * persisted message so the reasoning panel does not flicker empty.
 */
export class StreamCacheManager {
	private reasoningCache = new Map<number, string>();

	getCachedReasoning(order: number): string | undefined {
		return this.reasoningCache.get(order);
	}

	/** Stores non-empty reasoning; empty text keeps the previous entry. */
	updateReasoningCache(order: number, reasoning: string): void {
		if (reasoning) {
			this.reasoningCache.set(order, reasoning);
		}
	}

	clearReasoningCache(order: number): void {
		this.reasoningCache.delete(order);
	}

	clear(): void {
		this.reasoningCache.clear();
	}
}
