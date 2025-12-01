/**
 * Chat Core - Headless state management for AI chat
 *
 * This class manages all chat state and logic without any UI dependencies.
 * It can be used with any UI implementation.
 */

import type { ConvexClient } from 'convex/browser';
import type {
	ChatMessage,
	Attachment,
	SendMessageOptions,
	SendMessageResult,
	ChatConfig
} from './types.js';
import { DEFAULT_CHAT_CONFIG } from './types.js';
import { StreamCacheManager } from './StreamProcessor.js';

/**
 * API endpoints configuration for ChatCore
 */
export interface ChatCoreAPI {
	/** Mutation to send a message */
	sendMessage: Parameters<ConvexClient['mutation']>[0];
	/** Mutation to create a thread */
	createThread?: Parameters<ConvexClient['mutation']>[0];
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

	get optimisticMessages(): ChatMessage[] {
		return this.messages.filter((m) => m.metadata?.optimistic);
	}

	/**
	 * Initialize or load a thread
	 */
	setThread(threadId: string | null): void {
		this.threadId = threadId;
		this.messages = [];
		this.hasMore = false;
		this.continueCursor = null;
		this.error = null;
		this.streamCache.clear();
	}

	/**
	 * Update messages from query result
	 * Merges with existing messages, deduplicating by ID
	 * Prefers real messages over optimistic ones
	 */
	updateMessages(page: ChatMessage[], isDone: boolean, cursor: string | null): void {
		// Create a map of existing messages by ID
		const existingMap = new Map(this.messages.map((m) => [m.id, m]));

		// Create a map of new messages by ID (these override existing)
		const newMap = new Map(page.map((m) => [m.id, m]));

		// Merge: new messages override existing, keep existing if not in new
		// Remove optimistic messages if real version exists
		const merged = new Map<string, ChatMessage>();

		// Add all new messages first (they're authoritative)
		for (const [id, msg] of newMap) {
			merged.set(id, msg);
		}

		// Add existing messages that aren't in new results
		for (const [id, msg] of existingMap) {
			if (!merged.has(id)) {
				// Keep existing message if not optimistic or if no real version exists
				if (!msg.metadata?.optimistic) {
					merged.set(id, msg);
				}
			}
		}

		this.messages = Array.from(merged.values());
		this.hasMore = isDone === false;
		this.continueCursor = cursor;
	}

	/**
	 * Add an optimistic user message
	 */
	addOptimisticMessage(content: string, attachments: Attachment[] = []): ChatMessage {
		const optimisticMessage: ChatMessage = {
			id: `temp_${crypto.randomUUID()}`,
			_creationTime: Date.now(),
			threadId: this.threadId!,
			role: 'user',
			message: {
				role: 'user',
				content
			},
			text: content,
			status: 'success',
			order: this.messages.length,
			tool: false,
			metadata: { optimistic: true },
			localAttachments: attachments
		};

		this.messages = [...this.messages, optimisticMessage];
		return optimisticMessage;
	}

	/**
	 * Remove optimistic message
	 */
	removeOptimisticMessage(messageId: string): void {
		this.messages = this.messages.filter((m) => m.id !== messageId);
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
	 * - Optimistic updates
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
			throw new Error('Cannot send message: validation failed');
		}

		const trimmedPrompt = prompt.trim();
		this.setSending(true);
		this.setAwaitingStream(true);

		// Add optimistic message
		const optimisticMessage = this.addOptimisticMessage(trimmedPrompt, options?.attachments);

		try {
			// Send message with optional attachments
			const result = await client.mutation(this.api.sendMessage, {
				threadId: this.threadId,
				prompt: trimmedPrompt,
				fileIds: options?.fileIds
			});

			// Request widget to open if requested
			if (options?.openWidgetAfter) {
				this.requestWidgetOpen();
			}

			return result;
		} catch (error) {
			console.error('[ChatCore.sendMessage] Failed to send message:', error);
			this.setError('Failed to send message. Please try again.');
			this.removeOptimisticMessage(optimisticMessage.id);
			this.setAwaitingStream(false);
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
