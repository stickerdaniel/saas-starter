/**
 * Chat Core - Headless state management for AI chat
 *
 * This class manages all chat state and logic without any UI dependencies.
 * It can be used with any UI implementation.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type {
	SendMessageOptions,
	SendMessageResult,
	ChatConfig,
	CreateThreadOptions,
	ChatMessagesQuery
} from './types.js';
import { DEFAULT_CHAT_CONFIG } from './types.js';
import { StreamCacheManager } from './stream-cache.js';
import { createOptimisticUpdate, type ListMessagesArgs } from './optimistic.js';
import { getChatSessionEpoch, isChatSessionCurrent } from './chat-persisted-state.js';
import type { ChatSessionPort } from './chat-session-port.js';
import { ChatCommandError, type ChatCommandErrorCode } from './chat-command-error.js';

export type ChatCoreErrorCode = ChatCommandErrorCode | 'send_failed' | 'create_thread_failed';
type CreateThreadArgs = CreateThreadOptions & Record<string, unknown>;

/**
 * Result from creating a thread
 */
export interface CreateThreadResult {
	threadId: string;
	notificationEmail?: string | null;
	[key: string]: unknown;
}

/**
 * API endpoints configuration for ChatCore
 */
export interface ChatCoreAPI {
	/** Mutation to send a message */
	sendMessage: FunctionReference<
		'mutation',
		'public',
		{
			threadId: string;
			prompt: string;
			userId?: string;
			fileIds?: string[];
		},
		SendMessageResult
	>;
	/** Mutation to create a thread - returns CreateThreadResult */
	createThread?: FunctionReference<'mutation', 'public', CreateThreadArgs, CreateThreadResult>;
	/** Query to list messages (required for optimistic updates) */
	listMessages?: ChatMessagesQuery;
}

/**
 * Options for creating a ChatCore instance
 */
export interface ChatCoreOptions {
	/** Initial thread ID (optional) */
	threadId?: string | null;
	/** Bind commands for headless sends; omit when the surface owns its commands. */
	api?: ChatCoreAPI;
	/** Chat configuration */
	config?: ChatConfig;
}

/**
 * Chat Core class - Headless state management
 *
 * Manages thread state, messages, optimistic updates, and pagination.
 * Stream processing is handled separately via StreamCacheManager.
 */
export class ChatCore implements ChatSessionPort {
	// Thread state
	threadId = $state<string | null>(null);
	/** True when user starts a new conversation - enables immediate suggestion display */
	isNewConversation = $state(false);
	/** Monotonic counter — bumps each time a new thread session starts.
	 *  Used as a {#key} to replay chip entrance animations. */
	threadGeneration = $state(0);

	// Loading states
	isLoading = $state(false);
	isSending = $state(false);

	// Error state
	error = $state<ChatCoreErrorCode | null>(null);

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
	private readonly api?: ChatCoreAPI;
	private readonly config: Required<ChatConfig>;
	private sendRevision = 0;
	private provisionalThreadBinding: { threadId: string; sendRevision: number } | null = null;
	private threadOriginBinder?: (threadId: string, epoch: number, generation: number) => void;

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

	/**
	 * Initialize or load a thread
	 */
	setThreadOriginBinder(
		binder: ((threadId: string, epoch: number, generation: number) => void) | undefined
	): void {
		this.threadOriginBinder = binder;
	}

	setThread(threadId: string | null): void {
		const bindsActiveProvisionalThread =
			this.threadId === null &&
			threadId !== null &&
			this.provisionalThreadBinding?.threadId === threadId &&
			this.provisionalThreadBinding.sendRevision === this.sendRevision;
		if (threadId !== this.threadId && !bindsActiveProvisionalThread) {
			this.sendRevision++;
			this.provisionalThreadBinding = null;
			this.isSending = false;
			this.isAwaitingStream = false;
		}
		this.threadId = threadId;
		this.isNewConversation = threadId === null;
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
	setError(error: ChatCoreErrorCode | null): void {
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

	private isSendOperationCurrent(sessionEpoch: number, sendRevision: number): boolean {
		return isChatSessionCurrent(sessionEpoch) && this.sendRevision === sendRevision;
	}

	/**
	 * Send a message with optional file attachments
	 *
	 * This method handles the complete message sending flow:
	 * - Thread creation (if needed and createThread API configured)
	 * - Validation
	 * - Optimistic updates via store.setQuery (automatic rollback on failure)
	 * - Backend mutation
	 * - Error handling
	 * - Widget opening (optional)
	 *
	 * @param client - Convex client instance
	 * @param prompt - Message text content
	 * @param options - Optional configuration
	 * @returns Promise with message ID and optional thread creation result
	 */
	async sendMessage(
		client: ConvexClient,
		prompt: string,
		options?: SendMessageOptions
	): Promise<SendMessageResult & { threadCreated?: CreateThreadResult }> {
		const trimmedPrompt = prompt.trim();

		// Expected local refusals are machine-readable; callers own localized copy.
		if (!trimmedPrompt) {
			this.setError('empty_input');
			throw new ChatCommandError('empty_input');
		}
		if (this.isSending) {
			this.setError('send_in_progress');
			throw new ChatCommandError('send_in_progress');
		}

		const api = this.api;
		if (!api) {
			throw new Error('Chat commands are not configured for this session');
		}

		const sessionEpoch = getChatSessionEpoch();
		const sendRevision = ++this.sendRevision;
		this.clearError();
		this.setSending(true);
		this.setAwaitingStream(true);

		let threadCreated: CreateThreadResult | undefined;
		let failureCode: ChatCoreErrorCode = 'send_failed';

		try {
			// Ensure thread exists (lazy thread creation)
			let threadId = this.threadId;
			if (!threadId) {
				failureCode = 'create_thread_failed';
				if (!api.createThread) {
					throw new Error('Cannot send message: no thread and createThread not configured');
				}

				const result = await client.mutation(api.createThread, {
					...options?.createThreadOptions
				});
				if (!this.isSendOperationCurrent(sessionEpoch, sendRevision)) {
					throw new Error('Chat session ended');
				}

				threadId = result.threadId;
				threadCreated = result;
				this.provisionalThreadBinding = { threadId, sendRevision };
				this.threadOriginBinder?.(threadId, sessionEpoch, this.threadGeneration);

				// Update threadId directly (setThread would clear streamCache, error,
				// and the pagination cursors)
				this.threadId = threadId;
				this.provisionalThreadBinding = null;
				this.isNewConversation = false;
				failureCode = 'send_failed';
			}

			// Build optimistic update if listMessages query is available
			const mutationOptions = api.listMessages
				? {
						optimisticUpdate: createOptimisticUpdate(
							api.listMessages,
							{
								threadId,
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
				api.sendMessage,
				{
					threadId,
					prompt: trimmedPrompt,
					userId: options?.userId,
					fileIds: options?.fileIds
				},
				mutationOptions
			);
			if (!this.isSendOperationCurrent(sessionEpoch, sendRevision)) {
				return { ...result, threadCreated };
			}

			// Request widget to open if requested
			if (options?.openWidgetAfter) {
				this.requestWidgetOpen();
			}

			return { ...result, threadCreated };
		} catch (error) {
			if (this.isSendOperationCurrent(sessionEpoch, sendRevision)) {
				console.error('[ChatCore.sendMessage] Failed');
				this.setError(failureCode);
				this.setAwaitingStream(false);
			}
			// Optimistic update automatically rolled back on failure
			throw error;
		} finally {
			if (this.isSendOperationCurrent(sessionEpoch, sendRevision)) {
				this.setSending(false);
			}
		}
	}

	/**
	 * Create a new thread
	 *
	 * @param client - Convex client instance
	 * @param options - Thread creation options
	 * @returns Promise with thread creation result
	 */
	async createThread(
		client: ConvexClient,
		options?: CreateThreadOptions
	): Promise<CreateThreadResult> {
		if (!this.api?.createThread) {
			throw new Error('createThread API not configured');
		}

		this.setLoading(true);
		try {
			const result = await client.mutation(this.api.createThread, { ...options });
			this.setThread(result.threadId);
			return result;
		} catch (error) {
			console.error('[ChatCore.createThread] Failed');
			this.setError('create_thread_failed');
			throw error;
		} finally {
			this.setLoading(false);
		}
	}

	/** Reset session-owned flags without changing the selected thread. */
	forgetChatSession(): void {
		this.sendRevision++;
		this.provisionalThreadBinding = null;
		this.isSending = false;
		this.isAwaitingStream = false;
		this.error = null;
		this.shouldOpenWidget = false;
	}

	/**
	 * Reset the core state
	 */
	reset(): void {
		this.sendRevision++;
		this.provisionalThreadBinding = null;
		this.threadId = null;
		this.isNewConversation = false;
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

/** Create a new headless chat session. */
export function createChatCore(options: ChatCoreOptions): ChatCore {
	return new ChatCore(options);
}
