import { Context } from 'runed';
import type { PaginationResult } from 'convex/server';
import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import type { Attachment } from '$lib/chat';
import { StreamCacheManager } from '$lib/chat/core/StreamProcessor.js';

/**
 * View types for the support widget navigation
 */
export type SupportView = 'overview' | 'chat' | 'compose';

/**
 * Thread summary for the overview list
 */
export interface ThreadSummary {
	_id: string;
	_creationTime: number;
	userId?: string;
	title?: string;
	summary?: string;
	status: 'active' | 'archived';
	lastAgentName?: string;
	lastMessageRole?: 'user' | 'assistant' | 'tool' | 'system';
	lastMessage?: string;
	lastMessageAt?: number;
}

/**
 * Message interface matching Convex Agent message structure
 */
export interface SupportMessage {
	id: string; // Changed from _id to match UIMessage from listUIMessages
	_creationTime: number;
	threadId?: string;
	message?: {
		role: 'user' | 'assistant' | 'system' | 'tool';
		content: any; // Can be string or complex array structure
		providerOptions?: Record<string, any>;
	};
	text?: string; // Convenience field with full text content
	reasoning?: string; // Reasoning content (for models like DeepSeek R1)
	status: 'pending' | 'success' | 'failed' | 'streaming';
	order: number;
	tool?: boolean;
	agentName?: string;
	embeddingId?: string;
	model?: string;
	usage?: Record<string, any>;
	metadata?: Record<string, any>;
	// Additional UIMessage fields
	key?: string;
	role: 'user' | 'assistant' | 'system' | 'tool'; // Required (normalized)
	parts?: any[];
	stepOrder?: number;
	// Optimistic attachments
	localAttachments?: Attachment[];
}

/**
 * Thread context state
 */
export class SupportThreadContext {
	// User identification
	userId = $state<string | null>(null);

	// Navigation state
	currentView = $state<SupportView>('overview');

	// Current thread state
	threadId = $state<string | null>(null);
	threadAgentName = $state<string | undefined>(undefined);
	messages = $state<SupportMessage[]>([]);
	isLoading = $state(false);
	isSending = $state(false);
	error = $state<string | null>(null);
	shouldOpenWidget = $state(false);

	// Pagination state
	hasMore = $state(false);
	continueCursor = $state<string | null>(null);

	// Stream state (for ChatRoot compatibility)
	isAwaitingStream = $state(false);
	readonly streamCache = new StreamCacheManager();

	// Derived state
	get hasThread() {
		return this.threadId !== null;
	}

	get streamingMessages() {
		return this.messages.filter((m) => m.status === 'pending');
	}

	get isStreaming() {
		return this.streamingMessages.length > 0;
	}

	get currentAgentName(): string | undefined {
		return this.threadAgentName;
	}

	get optimisticMessages() {
		return this.messages.filter((m) => m.metadata?.optimistic);
	}

	/**
	 * Set awaiting stream state
	 */
	setAwaitingStream(awaiting: boolean) {
		this.isAwaitingStream = awaiting;
	}

	/**
	 * Initialize or load a thread
	 */
	setThread(threadId: string | null, agentName?: string) {
		this.threadId = threadId;
		this.threadAgentName = agentName;
		this.messages = [];
		this.hasMore = false;
		this.continueCursor = null;
	}

	/**
	 * Update messages from query result
	 * Merges with existing messages, deduplicating by ID
	 * Prefers real messages over optimistic ones
	 */
	updateMessages(result: PaginationResult<SupportMessage>) {
		const newMessages = result.page;

		// Create a map of existing messages by ID
		const existingMap = new Map(this.messages.map((m) => [m.id, m]));

		// Create a map of new messages by ID (these override existing)
		const newMap = new Map(newMessages.map((m) => [m.id, m]));

		// Merge: new messages override existing, keep existing if not in new
		// Remove optimistic messages if real version exists
		const merged = new Map<string, SupportMessage>();

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
		this.hasMore = result.isDone === false;
		this.continueCursor = result.continueCursor;
	}

	/**
	 * Add an optimistic user message
	 */
	addOptimisticMessage(content: string, attachments: Attachment[] = []): SupportMessage {
		const optimisticMessage: SupportMessage = {
			id: `temp_${Date.now()}`,
			_creationTime: Date.now(),
			threadId: this.threadId!,
			role: 'user', // Top-level role (normalized)
			message: {
				role: 'user',
				content
			},
			text: content, // Add convenience text field
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
	removeOptimisticMessage(messageId: string) {
		this.messages = this.messages.filter((m) => m.id !== messageId);
	}

	/**
	 * Set loading state
	 */
	setLoading(loading: boolean) {
		this.isLoading = loading;
	}

	/**
	 * Set sending state
	 */
	setSending(sending: boolean) {
		this.isSending = sending;
	}

	/**
	 * Set error state
	 */
	setError(error: string | null) {
		this.error = error;
	}

	/**
	 * Clear error
	 */
	clearError() {
		this.error = null;
	}

	/**
	 * Request widget to open (used when message sent from chatbar)
	 * Also switches to chat view if there's an active thread
	 */
	requestWidgetOpen() {
		this.shouldOpenWidget = true;
		// If we have an active thread, switch to chat view
		if (this.threadId) {
			this.currentView = 'chat';
		}
	}

	/**
	 * Clear widget open request
	 */
	clearWidgetOpenRequest() {
		this.shouldOpenWidget = false;
	}

	/**
	 * Send a message with optional file attachments
	 *
	 * This method handles the complete message sending flow:
	 * - Lazy thread creation (if threadId is null)
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
		options?: {
			fileIds?: string[];
			openWidgetAfter?: boolean;
			attachments?: Attachment[];
		}
	): Promise<{ messageId: string }> {
		// Validate input
		if (!prompt.trim() || this.isSending) {
			console.log('[sendMessage] Blocked - validation failed', {
				hasPrompt: !!prompt.trim(),
				isSending: this.isSending
			});
			throw new Error('Cannot send message: validation failed');
		}

		const trimmedPrompt = prompt.trim();
		this.setSending(true);

		// Add optimistic message
		const optimisticMessage = this.addOptimisticMessage(trimmedPrompt, options?.attachments);

		try {
			// Create thread if needed (lazy thread creation)
			let threadId = this.threadId;
			if (!threadId) {
				console.log('[sendMessage] Creating new thread for user:', this.userId);
				threadId = await client.mutation(api.support.threads.createThread, {
					userId: this.userId || undefined
				});
				// Just set threadId directly - don't call setThread() which clears messages
				// This preserves the optimistic message for seamless transition
				this.threadId = threadId;
				// Switch from compose to chat view
				this.currentView = 'chat';
			}

			console.log('[sendMessage] Sending message', {
				threadId,
				promptLength: trimmedPrompt.length,
				optimisticId: optimisticMessage.id,
				fileCount: options?.fileIds?.length || 0
			});

			// Send message with optional attachments
			const result = await client.mutation(api.support.messages.sendMessage, {
				threadId,
				prompt: trimmedPrompt,
				fileIds: options?.fileIds
			});

			console.log('[sendMessage] Message sent successfully', {
				messageId: result.messageId,
				optimisticId: optimisticMessage.id,
				fileCount: options?.fileIds?.length || 0
			});

			// Request widget to open if requested
			if (options?.openWidgetAfter) {
				this.requestWidgetOpen();
			}

			return result;
		} catch (error) {
			console.error('[sendMessage] Failed to send message:', error);
			this.setError('Failed to send message. Please try again.');
			this.removeOptimisticMessage(optimisticMessage.id);
			throw error;
		} finally {
			this.setSending(false);
		}
	}

	// ========================================
	// Navigation Methods
	// ========================================

	/**
	 * Set the user ID for thread management
	 */
	setUserId(userId: string | null) {
		this.userId = userId;
	}

	/**
	 * Select a thread and navigate to chat view
	 */
	selectThread(threadId: string, agentName?: string) {
		this.setThread(threadId, agentName);
		this.currentView = 'chat';
	}

	/**
	 * Start a new thread (navigate to compose view)
	 * Thread is created lazily on first message
	 */
	startNewThread() {
		this.setThread(null);
		this.currentView = 'compose';
	}

	/**
	 * Go back to the overview
	 * Note: We only change the view, not the thread state.
	 * This keeps messages visible during the slide-out animation.
	 * State is cleared when entering a new thread/compose via setThread().
	 */
	goBack() {
		this.currentView = 'overview';
	}

	/**
	 * Reset the context
	 */
	reset() {
		// Navigation state
		this.currentView = 'overview';
		this.userId = null;

		// Current thread state
		this.threadId = null;
		this.threadAgentName = undefined;
		this.messages = [];
		this.isLoading = false;
		this.isSending = false;
		this.error = null;
		this.shouldOpenWidget = false;
		this.hasMore = false;
		this.continueCursor = null;
	}
}

/**
 * Support thread context
 *
 * Use this context to share thread state across customer support components.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { supportThreadContext } from './support-thread-context.svelte';
 *
 *   const thread = supportThreadContext.get();
 *
 *   // Access thread state
 *   const { threadId, messages, isStreaming } = $derived(thread);
 * </script>
 * ```
 */
export const supportThreadContext = new Context<SupportThreadContext>('support-thread');
