import { Context } from 'runed';
import type { PaginationResult } from 'convex/server';

/**
 * Message interface matching Convex Agent message structure
 */
export interface SupportMessage {
	_id: string;
	_creationTime: number;
	threadId: string;
	message?: {
		role: 'user' | 'assistant' | 'system' | 'tool';
		content: any; // Can be string or complex array structure
		providerOptions?: Record<string, any>;
	};
	text?: string; // Convenience field with full text content
	status: 'pending' | 'success' | 'failed';
	order: number;
	tool: boolean;
	agentName?: string;
	embeddingId?: string;
	model?: string;
	usage?: Record<string, any>;
	metadata?: Record<string, any>;
}

/**
 * Thread context state
 */
export class SupportThreadContext {
	threadId = $state<string | null>(null);
	messages = $state<SupportMessage[]>([]);
	isLoading = $state(false);
	isSending = $state(false);
	error = $state<string | null>(null);
	shouldOpenWidget = $state(false);

	// Pagination state
	hasMore = $state(false);
	continueCursor = $state<string | null>(null);

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

	/**
	 * Initialize or load a thread
	 */
	setThread(threadId: string | null) {
		this.threadId = threadId;
		this.messages = [];
		this.hasMore = false;
		this.continueCursor = null;
	}

	/**
	 * Update messages from query result
	 */
	updateMessages(result: PaginationResult<SupportMessage>) {
		this.messages = result.page;
		this.hasMore = result.isDone === false;
		this.continueCursor = result.continueCursor;
	}

	/**
	 * Add an optimistic user message
	 */
	addOptimisticMessage(content: string): SupportMessage {
		const optimisticMessage: SupportMessage = {
			_id: `temp_${Date.now()}`,
			_creationTime: Date.now(),
			threadId: this.threadId!,
			message: {
				role: 'user',
				content
			},
			text: content, // Add convenience text field
			status: 'success',
			order: this.messages.length,
			tool: false,
			metadata: { optimistic: true }
		};

		this.messages = [...this.messages, optimisticMessage];
		return optimisticMessage;
	}

	/**
	 * Remove optimistic message
	 */
	removeOptimisticMessage(messageId: string) {
		this.messages = this.messages.filter((m) => m._id !== messageId);
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
	 */
	requestWidgetOpen() {
		this.shouldOpenWidget = true;
	}

	/**
	 * Clear widget open request
	 */
	clearWidgetOpenRequest() {
		this.shouldOpenWidget = false;
	}

	/**
	 * Reset the context
	 */
	reset() {
		this.threadId = null;
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
