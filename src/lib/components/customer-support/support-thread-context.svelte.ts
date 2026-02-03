import { Context, PersistedState } from 'runed';
import type { ConvexClient } from 'convex/browser';
import type { UIMessagePart, UIDataTypes, UITools } from 'ai';
import { isToolOrDynamicToolUIPart } from 'ai';
import { api } from '$lib/convex/_generated/api';
import type { Attachment } from '$lib/chat';
import { StreamCacheManager } from '$lib/chat/core/StreamProcessor.js';
import { createOptimisticUpdate, type ListMessagesArgs } from '$lib/chat/core/optimistic.js';

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
	parts?: UIMessagePart<UIDataTypes, UITools>[];
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

	// URL sync callback (called when thread changes for URL state updates)
	private onThreadChange?: (threadId: string | null) => void;

	// Convex client for mutations (set via setClient)
	private client: ConvexClient | null = null;

	// Track in-flight thread creation to avoid duplicates
	private threadCreationPromise: Promise<string> | null = null;

	// Current thread state
	threadId = $state<string | null>(null);
	threadAgentName = $state<string | undefined>(undefined);
	isHandedOff = $state(false); // Whether thread is handed off to human support
	assignedAdmin = $state<{ name?: string; image: string | null } | undefined>(undefined);
	notificationEmail = $state<string | null>(null); // Email for admin reply notifications
	isEmailPending = $state(false); // True while email mutation is in flight (green check hidden)
	messages = $state<SupportMessage[]>([]);
	isLoading = $state(false);
	isSending = $state(false);
	error = $state<string | null>(null);
	shouldOpenWidget = $state(false);

	/** True when user starts a new conversation - enables immediate suggestion display */
	isNewConversation = $state(false);

	// Pagination state
	hasMore = $state(false);
	continueCursor = $state<string | null>(null);

	// Stream state (for ChatRoot compatibility)
	isAwaitingStream = $state(false);
	readonly streamCache = new StreamCacheManager();

	// Rate limit state
	rateLimitedUntil = $state<number | null>(null);

	// Draft storage - persists input text per thread to localStorage
	readonly drafts = new PersistedState<Record<string, string>>('support-drafts', {});

	/**
	 * Get draft text for a thread
	 */
	getDraft(threadId: string | null): string {
		return threadId ? (this.drafts.current[threadId] ?? '') : '';
	}

	/**
	 * Save draft text for a thread
	 */
	setDraft(threadId: string | null, text: string): void {
		if (!threadId) return;
		if (text.trim()) {
			this.drafts.current[threadId] = text;
		} else {
			delete this.drafts.current[threadId];
		}
	}

	/**
	 * Clear draft for a thread (e.g., after sending)
	 */
	clearDraft(threadId: string | null): void {
		if (!threadId) return;
		delete this.drafts.current[threadId];
	}

	/**
	 * Check if currently rate limited
	 */
	get isRateLimited(): boolean {
		return this.rateLimitedUntil !== null && Date.now() < this.rateLimitedUntil;
	}

	/**
	 * Set rate limit expiration time
	 */
	setRateLimited(retryAfterMs: number) {
		this.rateLimitedUntil = Date.now() + retryAfterMs;
	}

	/**
	 * Clear rate limit state
	 */
	clearRateLimit() {
		this.rateLimitedUntil = null;
	}

	/**
	 * Set the Convex client for thread creation
	 * Must be called from customer-support.svelte after client is available
	 */
	setClient(client: ConvexClient) {
		this.client = client;
	}

	/**
	 * Ensure a thread exists, creating one if needed
	 * Returns existing threadId or creates a new one
	 * Safe to call multiple times - deduplicates in-flight requests
	 */
	async ensureThread(client: ConvexClient): Promise<string> {
		// Already have a thread
		if (this.threadId) return this.threadId;

		// Creation already in flight - return existing promise
		if (this.threadCreationPromise) return this.threadCreationPromise;

		// Start thread creation
		this.threadCreationPromise = client
			.mutation(api.support.threads.createThread, {
				userId: this.userId || undefined,
				pageUrl: typeof window !== 'undefined' ? window.location.href : undefined
			})
			.then((result) => {
				// Only update state if user is still in chat view (didn't navigate away)
				if (!this.threadId && this.currentView === 'chat') {
					this.threadId = result.threadId;
					this.notificationEmail = result.notificationEmail ?? null;
					this.onThreadChange?.(result.threadId);
				}
				return result.threadId;
			})
			.finally(() => {
				this.threadCreationPromise = null;
			});

		return this.threadCreationPromise;
	}

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

	/**
	 * Check if any message has pending tool calls awaiting user response
	 */
	get hasPendingToolCalls(): boolean {
		return this.messages.some((msg) =>
			msg.parts?.some(
				(p) => isToolOrDynamicToolUIPart(p) && p.state === 'input-available' && !p.output
			)
		);
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
	setThread(
		threadId: string | null,
		agentName?: string,
		isHandedOff?: boolean,
		assignedAdmin?: { name?: string; image: string | null },
		notificationEmail?: string | null
	) {
		this.threadId = threadId;
		this.threadAgentName = agentName;
		this.isHandedOff = isHandedOff ?? false;
		this.assignedAdmin = assignedAdmin;
		this.notificationEmail = notificationEmail ?? null;
		this.messages = [];
		this.hasMore = false;
		this.continueCursor = null;
	}

	/**
	 * Set the handoff status (called when thread data is loaded)
	 */
	setHandedOff(isHandedOff: boolean) {
		this.isHandedOff = isHandedOff;
	}

	/**
	 * Request handoff to human support
	 * This is a permanent action - AI will never respond in this thread again
	 */
	async requestHandoff(client: ConvexClient): Promise<boolean> {
		// Capture values in local variables to avoid $state proxy issues with optimistic updates
		const threadId = this.threadId;
		const userId = this.userId;

		if (!threadId) {
			console.error('[requestHandoff] No thread ID');
			return false;
		}

		// Optimistically hide the button immediately
		this.isHandedOff = true;

		try {
			// Build query args for optimistic update (must match ChatRoot's query)
			const queryArgs: ListMessagesArgs = {
				threadId,
				paginationOpts: { numItems: 50, cursor: null },
				streamArgs: { kind: 'list' as const, startOrder: 0 }
			};

			// Send mutation with optimistic update for user message
			await client.mutation(
				api.support.threads.updateThreadHandoff,
				{ threadId, userId: userId || undefined },
				{
					optimisticUpdate: createOptimisticUpdate(
						api.support.messages.listMessages,
						queryArgs,
						'user',
						'Talk to support' // Match backend hardcoded message
					)
				}
			);
			return true;
		} catch (error) {
			// Rollback on error
			this.isHandedOff = false;
			console.error('[requestHandoff] Failed:', error);
			this.setError('Failed to request human support. Please try again.');
			return false;
		}
	}

	/**
	 * Set notification email for this thread
	 * User will be notified when an admin responds (with 30-min cooldown)
	 *
	 * Uses Convex optimistic update to immediately show subscribed state,
	 * while isEmailPending tracks whether mutation is still in flight.
	 * Green check only shows when !isEmailPending (server confirmed).
	 */
	async setNotificationEmail(client: ConvexClient, email: string): Promise<boolean> {
		// Capture values to avoid $state proxy issues
		const threadId = this.threadId;
		const userId = this.userId;

		if (!threadId) {
			console.error('[setNotificationEmail] No thread ID');
			return false;
		}

		const normalizedEmail = email.trim().toLowerCase();

		// Mark as pending - green check only shows when mutation completes AND query has
		// propagated the new email AND there's no local optimistic override
		this.isEmailPending = true;

		try {
			// Build query args (must match threadQuery in feedback-widget.svelte)
			const queryArgs = { threadId, userId: userId || undefined };

			await client.mutation(
				api.support.threads.updateNotificationEmail,
				{ threadId, email: normalizedEmail, userId: userId || undefined },
				{
					optimisticUpdate: (store) => {
						const current = store.getQuery(api.support.threads.getThread, queryArgs);
						if (current !== undefined) {
							store.setQuery(api.support.threads.getThread, queryArgs, {
								...current,
								notificationEmail: normalizedEmail || undefined
							});
						}
					}
				}
			);

			// Mutation succeeded - update local state (query subscription will also update)
			this.notificationEmail = normalizedEmail || null;
			return true;
		} catch (error) {
			console.error('[setNotificationEmail] Failed:', error);
			this.setError('Failed to save email. Please try again.');
			return false;
		} finally {
			// Clear pending state - green check can now appear
			this.isEmailPending = false;
		}
	}

	/**
	 * Send a message with optional file attachments
	 *
	 * This method handles the complete message sending flow:
	 * - Thread creation (if no thread exists and no threadId provided)
	 * - Building optimistic update
	 * - Sending mutation
	 *
	 * Blocking behavior:
	 * - AI mode (not handed off): Blocks until AI responds
	 * - Handed-off mode: Fire-and-forget, allows multiple messages
	 *
	 * @param client - Convex client instance
	 * @param prompt - Message text content
	 * @param options - Optional file IDs, attachments, and pre-created threadId
	 * @returns Promise with result (throws on error for caller to handle)
	 */
	async sendMessage(
		client: ConvexClient,
		prompt: string,
		options?: {
			fileIds?: string[];
			attachments?: Attachment[];
			/** Pre-created threadId (e.g., from chatbar's eager thread creation) */
			threadId?: string;
		}
	): Promise<{ threadId: string; threadCreated: boolean }> {
		const trimmedPrompt = prompt.trim();

		// Validate input
		if (!trimmedPrompt) {
			throw new Error('Cannot send message: empty prompt');
		}

		// In AI mode (not handed off), block multiple sends until AI responds
		// In handed-off mode, allow fire-and-forget like admin view
		if (!this.isHandedOff && (this.isSending || this.isAwaitingStream || this.isStreaming)) {
			throw new Error('Cannot send message: waiting for AI response');
		}

		// Set sending state (used for blocking in AI mode)
		this.setSending(true);

		let threadCreated = false;

		try {
			// Use provided threadId, context threadId, or await in-flight creation
			let threadId = options?.threadId ?? this.threadId;

			// Wait for any in-flight thread creation to complete (prevents duplicate threads)
			if (!threadId && this.threadCreationPromise) {
				try {
					threadId = await this.threadCreationPromise;
				} catch {
					// If ensureThread failed, we'll create a new thread below
				}
			}

			// Create thread if none exists
			if (!threadId) {
				const result = await client.mutation(api.support.threads.createThread, {
					userId: this.userId || undefined,
					pageUrl: typeof window !== 'undefined' ? window.location.href : undefined
				});
				threadId = result.threadId;
				threadCreated = true;

				// Update context state (don't call setThread which clears messages)
				this.threadId = threadId;
				this.notificationEmail = result.notificationEmail ?? null;
				this.currentView = 'chat';
			} else if (!this.threadId) {
				// Thread was pre-created (e.g., by chatbar), update context
				this.threadId = threadId;
				this.currentView = 'chat';
			}

			// Build query args for optimistic update (must match ChatRoot's query exactly)
			const queryArgs: ListMessagesArgs = {
				threadId,
				paginationOpts: { numItems: 50, cursor: null },
				streamArgs: { kind: 'list' as const, startOrder: 0 }
			};

			// Send message with optimistic update
			// Note: File dimensions are now stored in fileMetadata table at upload time,
			// so we no longer need to pass fileDimensions here
			await client.mutation(
				api.support.messages.sendMessage,
				{
					threadId,
					prompt: trimmedPrompt,
					userId: this.userId || undefined,
					fileIds: options?.fileIds?.length ? options.fileIds : undefined
				},
				{
					optimisticUpdate: createOptimisticUpdate(
						api.support.messages.listMessages,
						queryArgs,
						'user',
						trimmedPrompt,
						{ attachments: options?.attachments?.length ? options.attachments : undefined }
					)
				}
			);

			// In AI mode, mark as awaiting stream until AI starts responding
			// This blocks further sends until the AI response finishes
			if (!this.isHandedOff) {
				this.isAwaitingStream = true;
			}

			return { threadId, threadCreated };
		} catch (error) {
			console.error('[sendMessage] Failed:', error);
			this.setError(error instanceof Error ? error.message : 'Failed to send message');
			throw error;
		} finally {
			// Clear sending state
			this.setSending(false);
		}
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
	 * Set callback for thread changes (used for URL state sync)
	 */
	setOnThreadChange(callback: ((threadId: string | null) => void) | undefined) {
		this.onThreadChange = callback;
	}

	/**
	 * Select a thread and navigate to chat view
	 */
	selectThread(
		threadId: string,
		agentName?: string,
		isHandedOff?: boolean,
		assignedAdmin?: { name?: string; image: string | null },
		notificationEmail?: string | null
	) {
		this.setThread(threadId, agentName, isHandedOff, assignedAdmin, notificationEmail);
		this.currentView = 'chat';
		this.isNewConversation = false;
		this.onThreadChange?.(threadId);
	}

	/**
	 * Select a thread from URL (loads thread details from backend)
	 * Used when opening widget from a shared link with ?thread=xxx
	 */
	selectThreadFromUrl(threadId: string) {
		// Set thread ID and switch to chat view
		// Full thread details (agentName, isHandedOff, etc.) will be loaded
		// reactively by the chat component's query
		this.threadId = threadId;
		this.currentView = 'chat';
		this.isNewConversation = false;
		// Don't call onThreadChange here - this is triggered BY the URL
	}

	/**
	 * Start a new thread (navigate to chat view)
	 * Thread is created eagerly for immediate optimistic updates
	 */
	startNewThread() {
		this.setThread(null);
		this.currentView = 'chat';
		this.isNewConversation = true;
		this.onThreadChange?.(null);

		// Trigger eager thread creation if client is available
		if (this.client) {
			void this.ensureThread(this.client).catch((error) => {
				console.error('[startNewThread] Thread creation failed:', error);
				this.setError('Failed to start conversation. Please try again.');
			});
		}
	}

	/**
	 * Go back to the overview
	 * Note: We only change the view, not the thread state.
	 * This keeps messages visible during the slide-out animation.
	 * State is cleared when entering a new thread/compose via setThread().
	 */
	goBack() {
		this.currentView = 'overview';
		this.onThreadChange?.(null);
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
		this.isHandedOff = false;
		this.assignedAdmin = undefined;
		this.notificationEmail = null;
		this.isEmailPending = false;
		this.messages = [];
		this.isLoading = false;
		this.isSending = false;
		this.error = null;
		this.shouldOpenWidget = false;
		this.isNewConversation = false;
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
