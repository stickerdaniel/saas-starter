/**
 * Display Message Processor
 *
 * Pure, testable functions for transforming chat messages into display format.
 * Handles streaming state, reasoning fallback, and text extraction.
 */

import type { ChatMessage, DisplayMessage } from './types.js';
import { extractReasoning, extractUserMessageText } from './StreamProcessor.js';
import type { StreamCacheManager } from './StreamProcessor.js';

/**
 * Context for transforming messages with streaming data
 */
export interface TransformContext {
	/** Set of message keys currently being streamed (format: "order-stepOrder") */
	streamingKeys: Set<string>;
	/** Map of order -> streaming text content */
	streamTextMap: Map<number, string>;
	/** Map of order -> streaming reasoning content */
	streamReasoningMap: Map<number, string>;
	/** Map of order -> stream status */
	streamStatusMap: Map<number, string>;
	/** Map of real message ID -> optimistic ID for stable render keys */
	optimisticKeyMap: Map<string, string>;
	/** Cache manager for reasoning persistence */
	streamCache: StreamCacheManager;
}

/**
 * Result of reasoning resolution
 */
export interface ReasoningResult {
	/** Final reasoning text to display */
	displayReasoning: string;
	/** Whether to update the cache with current reasoning */
	shouldUpdateCache: boolean;
	/** Whether to clear the cache (persisted reasoning now available) */
	shouldClearCache: boolean;
}

/**
 * Resolve reasoning with three-tier fallback and cache management
 *
 * Priority order:
 * 1. Stream reasoning (live from delta)
 * 2. Persisted reasoning (from message.parts or message.reasoning)
 * 3. Cached reasoning (for streamed messages during transitions)
 *
 * @param msg - The chat message
 * @param options - Resolution options
 * @returns Resolved reasoning with cache instructions
 */
export function resolveReasoning(
	msg: ChatMessage,
	options: {
		isBeingStreamed: boolean;
		streamReasoning?: string;
		streamCache: StreamCacheManager;
	}
): ReasoningResult {
	const { isBeingStreamed, streamReasoning, streamCache } = options;

	// Get persisted reasoning from message
	const persistedReasoning = msg.parts ? extractReasoning(msg.parts) : msg.reasoning || '';

	// Only use cached reasoning for messages that were actually streamed
	const cachedReasoning = isBeingStreamed ? streamCache.getCachedReasoning(msg.order) || '' : '';

	// Three-tier fallback: stream > persisted > cached
	const currentReasoning = streamReasoning || persistedReasoning;
	const displayReasoning = currentReasoning || cachedReasoning;

	// Determine cache operations
	const shouldUpdateCache = isBeingStreamed && !!currentReasoning;
	const shouldClearCache =
		isBeingStreamed && !!persistedReasoning && !!cachedReasoning && !streamReasoning;

	return {
		displayReasoning,
		shouldUpdateCache,
		shouldClearCache
	};
}

/**
 * Transform a single chat message to display format
 *
 * Handles:
 * - Text extraction for user/assistant messages
 * - Streaming data application
 * - Reasoning resolution with caching
 * - Render key mapping for optimistic updates
 *
 * @param msg - The chat message to transform
 * @param context - Transformation context with streaming data
 * @returns Display message with all display fields populated
 */
export function transformToDisplayMessage(
	msg: ChatMessage,
	context: TransformContext
): DisplayMessage {
	const {
		streamingKeys,
		streamTextMap,
		streamReasoningMap,
		streamStatusMap,
		optimisticKeyMap,
		streamCache
	} = context;

	// Determine if this specific message is being streamed
	const msgKey = `${msg.order}-${(msg as { stepOrder?: number }).stepOrder ?? 0}`;
	const isBeingStreamed = streamingKeys.has(msgKey);

	// Get streaming data only if this message is being streamed
	const streamText = isBeingStreamed ? streamTextMap.get(msg.order) : undefined;
	const streamReasoning = isBeingStreamed ? streamReasoningMap.get(msg.order) : undefined;
	const streamStatus = isBeingStreamed ? streamStatusMap.get(msg.order) : undefined;

	const isStreaming = streamStatus === 'streaming';
	const hasReasoningStream = isBeingStreamed && streamStatus !== undefined;

	// Extract display text
	const isUser = msg.role === 'user';
	let displayText = '';
	if (isUser) {
		displayText = extractUserMessageText(msg);
	} else {
		displayText = streamText || msg.text || '';
	}

	// Resolve reasoning with three-tier fallback
	const reasoningResult = resolveReasoning(msg, {
		isBeingStreamed,
		streamReasoning,
		streamCache
	});

	// Apply cache operations
	if (reasoningResult.shouldUpdateCache) {
		streamCache.updateReasoningCache(msg.order, reasoningResult.displayReasoning);
	}
	if (reasoningResult.shouldClearCache) {
		streamCache.clearReasoningCache(msg.order);
	}

	return {
		...msg,
		_renderKey: optimisticKeyMap.get(msg.id),
		displayText,
		displayReasoning: reasoningResult.displayReasoning,
		isStreaming,
		hasReasoningStream
	};
}

/**
 * Transform messages without streaming context (simple path)
 *
 * Used when there are no active streams - provides a faster code path
 * that skips streaming-related lookups.
 *
 * @param msg - The chat message to transform
 * @param optimisticKeyMap - Map of real message ID -> optimistic ID
 * @returns Display message for non-streaming context
 */
export function transformToDisplayMessageSimple(
	msg: ChatMessage,
	optimisticKeyMap: Map<string, string>
): DisplayMessage {
	const isUser = msg.role === 'user';
	let displayText = '';
	if (isUser) {
		displayText = extractUserMessageText(msg);
	} else {
		displayText = msg.text || '';
	}

	const reasoning = msg.parts ? extractReasoning(msg.parts) : msg.reasoning || '';

	return {
		...msg,
		_renderKey: optimisticKeyMap.get(msg.id),
		displayText,
		displayReasoning: reasoning,
		isStreaming: false,
		hasReasoningStream: !!reasoning
	};
}
