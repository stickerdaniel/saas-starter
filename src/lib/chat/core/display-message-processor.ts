/**
 * Display Message Processor
 *
 * Pure, testable functions for transforming chat messages into display format.
 * Handles streaming state, reasoning fallback, and text extraction.
 */

import type { ChatMessage, DisplayMessage } from './types.js';
import { extractReasoning, extractUserMessageText } from './message-extraction.js';
import type { StreamCacheManager } from './stream-cache.js';
import type { UIMessage } from '@convex-dev/agent';
import { mergeAssistantMessageParts } from './stream-materialization.js';

/**
 * Context for transforming messages with streaming data
 */
export interface TransformContext {
	/** Map of order -> latest grouped streaming UI message */
	streamMessageMap: Map<number, UIMessage>;
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
 * Defensive render guard: collapse duplicate message IDs so keyed each blocks do not crash
 * during brief query/stream reconciliation windows.
 */
export function dedupeDisplayMessagesForRender(messages: DisplayMessage[]): DisplayMessage[] {
	const lastIndexById = new Map<string, number>();
	messages.forEach((message, index) => {
		lastIndexById.set(message.id, index);
	});

	if (lastIndexById.size === messages.length) return messages;

	return messages.filter((message, index) => lastIndexById.get(message.id) === index);
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
 *
 * @param msg - The chat message to transform
 * @param context - Transformation context with streaming data
 * @returns Display message with all display fields populated
 */
export function transformToDisplayMessage(
	msg: ChatMessage,
	context: TransformContext
): DisplayMessage {
	const { streamMessageMap, streamCache } = context;

	// Assistant messages are grouped by order. Live stream overlays should match that grouped shape.
	const isBeingStreamed = msg.role === 'assistant' && streamMessageMap.has(msg.order);

	// Get streaming data only if this message is being streamed
	const streamMessage = isBeingStreamed ? streamMessageMap.get(msg.order) : undefined;
	const streamText = streamMessage?.text;
	const streamReasoning = extractReasoning(streamMessage?.parts);
	const streamStatus = streamMessage?.status;
	const streamParts = streamMessage?.parts;

	const isStreaming = streamStatus === 'streaming';
	const hasReasoningStream = !!streamMessage;

	const displayText = getDisplayText(msg, streamText);

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

	const mergedParts =
		msg.role === 'assistant' && streamParts
			? (mergeAssistantMessageParts(
					(msg.parts ?? []) as UIMessage['parts'],
					streamParts
				) as ChatMessage['parts'])
			: (streamParts ?? msg.parts);

	return {
		...msg,
		parts: mergedParts,
		displayText,
		displayReasoning: reasoningResult.displayReasoning,
		isStreaming,
		hasReasoningStream
	};
}

function getDisplayText(msg: ChatMessage, streamText?: string): string {
	if (msg.role === 'user') {
		return extractUserMessageText(msg);
	}

	return streamText || msg.text || '';
}
