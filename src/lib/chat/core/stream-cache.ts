import type { StreamStatus } from './types.js';

/**
 * Cache manager for stream state
 *
 * Manages reasoning cache and stream status cache to prevent UI flicker
 * during query transitions.
 */
export class StreamCacheManager {
	private reasoningCache = new Map<number, string>();
	private streamStatusCache = new Map<number, StreamStatus>();

	/**
	 * Get cached reasoning for a message order
	 */
	getCachedReasoning(order: number): string | undefined {
		return this.reasoningCache.get(order);
	}

	/**
	 * Update reasoning cache
	 */
	updateReasoningCache(order: number, reasoning: string): void {
		if (reasoning) {
			this.reasoningCache.set(order, reasoning);
		}
	}

	/**
	 * Clear reasoning cache for a message order
	 */
	clearReasoningCache(order: number): void {
		this.reasoningCache.delete(order);
	}

	/**
	 * Get cached stream status for a message order
	 */
	getCachedStatus(order: number): StreamStatus | undefined {
		return this.streamStatusCache.get(order);
	}

	/**
	 * Update stream status cache
	 */
	updateStatusCache(order: number, status: StreamStatus): void {
		this.streamStatusCache.set(order, status);
	}

	/**
	 * Check if status cache has entry for order
	 */
	hasStatusCache(order: number): boolean {
		return this.streamStatusCache.has(order);
	}

	/**
	 * Clear all caches
	 */
	clear(): void {
		this.reasoningCache.clear();
		this.streamStatusCache.clear();
	}
}
