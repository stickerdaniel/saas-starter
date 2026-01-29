/**
 * Chat Core - Headless state management for AI chat
 *
 * This class manages all chat state and logic without any UI dependencies.
 * It can be used with any UI implementation.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type { ChatMessage, SendMessageOptions, SendMessageResult, ChatConfig } from './types.js';
import { DEFAULT_CHAT_CONFIG } from './types.js';
import { StreamCacheManager } from './StreamProcessor.js';
import { createOptimisticUpdate, type ListMessagesArgs } from './optimistic.js';

/**
 * API endpoints configuration for ChatCore
 */
export interface ChatCoreAPI {
	/** Mutation to send a message */
	sendMessage: Parameters<ConvexClient['mutation']>[0];
	/** Mutation to create a thread */
	createThread?: Parameters<ConvexClient['mutation']>[0];
	/** Query to list messages (required for optimistic updates) */
	listMessages?: FunctionReference<'query'>;
}

/**
 * Options for creating a ChatCore instance
 */
export interface ChatCoreOptions {
	/** Initial thread ID (optional) */
	threadId?: string | null;
	/** Convex API endpoints */
	api: ChatCoreAPI;
	/** Chat configuration */
	config?: ChatConfig;
}

/**
 * Chat Core class - Headless state management
 *
 * Manages thread state, messages, optimistic updates, and pagination.
 * Stream processing is handled separately via StreamCacheManager.
 */
export class ChatCore {
	// Thread state
	threadId = $state<string | null>(null);
	/** True when user starts a new conversation - enables immediate suggestion display */
	isNewConversation = $state(false);

	// Messages state
	messages = $state<ChatMessage[]>([]);

	// Loading states
	isLoading = $state(false);
	isSending = $state(false);

	// Error state
	error = $state<string | null>(null);

	// Pagination state
	hasMore = $state(false);
	continueCursor = $state<string | null>(null);

	// Widget state (for support chat widget)
	shouldOpenWidget = $state(false);

	// Awaiting stream state (sticky until stream arrives)
	isAwaitingStream = $state(false);

	// Stream cache manager
	readonly streamCache = new StreamCacheManager();

	// Configuration
	private readonly api: ChatCoreAPI;
	private readonly config: Required<ChatConfig>;

	constructor(options: ChatCoreOptions) {
		this.threadId = options.threadId ?? null;
		this.isNewConversation = this.threadId === null;
		this.api = options.api;
		this.config = { ...DEFAULT_CHAT_CONFIG, ...options.config };
	}

	// Derived state
	get hasThread(): boolean {
		return this.threadId !== null;
	}

	get streamingMessages(): ChatMessage[] {
		return this.messages.filter((m) => m.status === 'pending' || m.status === 'streaming');
	}

	get isStreaming(): boolean {
		return this.streamingMessages.length > 0;
	}

	/**
	 * Initialize or load a thread
	 */
	setThread(threadId: string | null): void {
		this.threadId = threadId;
		this.isNewConversation = threadId === null;
		this.messages = [];
		this.hasMore = false;
		this.continueCursor = null;
		this.error = null;
		this.streamCache.clear();
	}

	/**
	 * Set loading state
	 */
	setLoading(loading: boolean): void {
		this.isLoading = loading;
	}

	/**
	 * Set sending state
	 */
	setSending(sending: boolean): void {
		this.isSending = sending;
	}

	/**
	 * Set error state
	 */
	setError(error: string | null): void {
		this.error = error;
	}

	/**
	 * Clear error
	 */
	clearError(): void {
		this.error = null;
	}

	/**
	 * Request widget to open (used when message sent from chatbar)
	 */
	requestWidgetOpen(): void {
		this.shouldOpenWidget = true;
	}

	/**
	 * Clear widget open request
	 */
	clearWidgetOpenRequest(): void {
		this.shouldOpenWidget = false;
	}

	/**
	 * Set awaiting stream state
	 */
	setAwaitingStream(awaiting: boolean): void {
		this.isAwaitingStream = awaiting;
	}

	/**
	 * Send a message with optional file attachments
	 *
	 * This method handles the complete message sending flow:
	 * - Validation
	 * - Optimistic updates via store.setQuery (automatic rollback on failure)
	 * - Backend mutation
	 * - Error handling
	 * - Widget opening (optional)
	 *
	 * @param client - Convex client instance
	 * @param prompt - Message text content
	 * @param options - Optional configuration
	 * @returns Promise with message ID
	 */
	async sendMessage(
		client: ConvexClient,
		prompt: string,
		options?: SendMessageOptions
	): Promise<SendMessageResult> {
		// Validate input
		if (!prompt.trim() || !this.threadId || this.isSending) {
			this.setError('Cannot send message yet. Please try again.');
			throw new Error('Cannot send message: validation failed');
		}

		const trimmedPrompt = prompt.trim();
		this.setSending(true);
		this.setAwaitingStream(true);

		try {
			// Build optimistic update if listMessages query is available
			const mutationOptions = this.api.listMessages
				? {
						optimisticUpdate: createOptimisticUpdate(
							this.api.listMessages,
							{
								threadId: this.threadId,
								paginationOpts: { numItems: this.config.pageSize, cursor: null },
								streamArgs: { kind: 'list' as const, startOrder: 0 }
							} satisfies ListMessagesArgs,
							'user',
							trimmedPrompt,
							{ attachments: options?.attachments }
						)
					}
				: undefined;

			// Send message with optional attachments and optimistic update
			const result = await client.mutation(
				this.api.sendMessage,
				{
					threadId: this.threadId,
					prompt: trimmedPrompt,
					fileIds: options?.fileIds
				},
				mutationOptions
			);

			// Request widget to open if requested
			if (options?.openWidgetAfter) {
				this.requestWidgetOpen();
			}

			return result;
		} catch (error) {
			console.error('[ChatCore.sendMessage] Failed to send message:', error);
			this.setError('Failed to send message. Please try again.');
			this.setAwaitingStream(false);
			// Optimistic update automatically rolled back on failure
			throw error;
		} finally {
			this.setSending(false);
		}
	}

	/**
	 * Create a new thread
	 *
	 * @param client - Convex client instance
	 * @param options - Thread creation options
	 * @returns Promise with thread ID
	 */
	async createThread(
		client: ConvexClient,
		options?: { userId?: string; title?: string }
	): Promise<string> {
		if (!this.api.createThread) {
			throw new Error('createThread API not configured');
		}

		this.setLoading(true);
		try {
			const result = await client.mutation(this.api.createThread, options ?? {});
			this.setThread(result.threadId);
			return result.threadId;
		} catch (error) {
			console.error('[ChatCore.createThread] Failed to create thread:', error);
			this.setError('Failed to create thread. Please try again.');
			throw error;
		} finally {
			this.setLoading(false);
		}
	}

	/**
	 * Reset the core state
	 */
	reset(): void {
		this.threadId = null;
		this.isNewConversation = false;
		this.messages = [];
		this.isLoading = false;
		this.isSending = false;
		this.error = null;
		this.shouldOpenWidget = false;
		this.hasMore = false;
		this.continueCursor = null;
		this.isAwaitingStream = false;
		this.streamCache.clear();
	}
}

/**
 * Create a new ChatCore instance
 */
export function createChatCore(options: ChatCoreOptions): ChatCore {
	return new ChatCore(options);
}
