/**
 * Chat UI Context
 *
 * Provides context for chat UI components to access shared state and configuration.
 * Uses Svelte's native context API with a class-based approach for type safety.
 */

import { getContext, setContext, untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';
import type { ConvexClient } from 'convex/browser';
import type { ChatCore } from '../core/ChatCore.svelte.js';
import type { DisplayMessage, Attachment, MessageRole } from '../core/types.js';
import { uploadFileWithProgress } from '../core/FileUploader.js';
import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.js';

/**
 * Message alignment - controls which side messages appear on
 */
export type ChatAlignment = 'left' | 'right';

/**
 * Configuration for file uploads
 */
export interface UploadConfig {
	generateUploadUrl: Parameters<ConvexClient['mutation']>[0];
	saveUploadedFile: Parameters<ConvexClient['action']>[0];
	/** Locale for translated error messages */
	locale?: string;
	/** Optional access key provider for file control */
	getAccessKey?: () => string | undefined;
	/** Provider for extra args to pass to generateUploadUrl (e.g., anonymousUserId for rate limiting) */
	getGenerateUploadUrlArgs?: () => Record<string, unknown>;
}

/**
 * Chat UI Context class
 *
 * Holds both the core state and UI-specific state like reasoning accordion states.
 */
export class ChatUIContext {
	/** The core chat state manager */
	readonly core: ChatCore;

	/** Convex client for queries/mutations */
	readonly client: ConvexClient;

	/** Upload configuration (optional - required for uploadFile method) */
	readonly uploadConfig?: UploadConfig;

	/** User message alignment (assistant gets opposite) */
	readonly userAlignment: ChatAlignment;

	/** UI state: which reasoning accordions are open */
	reasoningOpenState = $state(new SvelteMap<string, boolean>());

	/** Tracks messages that have been auto-opened (for auto-close logic) */
	autoOpenedMessages = $state(new SvelteSet<string>());

	/** Tracks reasoning blocks the user has manually toggled (auto-sync should not override) */
	userToggledMessages = $state(new SvelteSet<string>());

	/** Processed messages with display fields (set by ChatMessages) */
	displayMessages = $state<DisplayMessage[]>([]);

	/** Whether the messages query has resolved (prevents suggestion chip flash) */
	messagesReady = $state(false);

	/** Fade animation state for messages */
	readonly messagesFade = new FadeOnLoad<DisplayMessage[]>();

	/** Current input value */
	inputValue = $state('');

	/** Attachments for current message - keyed by unique ID for progress updates */
	attachments = $state<Attachment[]>([]);

	/** Internal map for tracking attachment keys (for progress updates) - not reactive, internal only */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal tracking map, not reactive state
	private attachmentKeys = new Map<number, string>();
	private nextAttachmentIndex = 0;

	/** Tracks if we've ever displayed messages in this session */
	private _hasEverDisplayedMessages = false;

	/** Last known thread ID for detecting navigation */
	private _lastThreadId: string | null | undefined = undefined;

	constructor(
		core: ChatCore,
		client: ConvexClient,
		uploadConfig?: UploadConfig,
		userAlignment: ChatAlignment = 'right'
	) {
		this.core = core;
		this.client = client;
		this.uploadConfig = uploadConfig;
		this.userAlignment = userAlignment;
	}

	/**
	 * Get alignment for a given role
	 * User messages use userAlignment, all other roles get the opposite
	 */
	getAlignment(role: MessageRole): ChatAlignment {
		if (role === 'user') return this.userAlignment;
		return this.userAlignment === 'right' ? 'left' : 'right';
	}

	/**
	 * Check if reasoning accordion is open for a message
	 */
	isReasoningOpen(messageId: string): boolean {
		return this.reasoningOpenState.get(messageId) ?? false;
	}

	/**
	 * Set reasoning accordion open state
	 */
	setReasoningOpen(messageId: string, isOpen: boolean): void {
		this.reasoningOpenState.set(messageId, isOpen);
	}

	/**
	 * Toggle reasoning accordion
	 */
	toggleReasoning(messageId: string): void {
		const current = this.reasoningOpenState.get(messageId) ?? false;
		this.reasoningOpenState.set(messageId, !current);
	}

	/**
	 * Check if a message was auto-opened (for auto-close logic)
	 */
	wasAutoOpened(messageId: string): boolean {
		return this.autoOpenedMessages.has(messageId);
	}

	/**
	 * Mark a message as having been auto-opened
	 */
	markAutoOpened(messageId: string): void {
		this.autoOpenedMessages.add(messageId);
	}

	/**
	 * Clear auto-opened tracking for a message (after auto-close)
	 */
	clearAutoOpened(messageId: string): void {
		this.autoOpenedMessages.delete(messageId);
	}

	getAutoOpenedKeys(): Iterable<string> {
		return this.autoOpenedMessages.keys();
	}

	/**
	 * Mark a reasoning block as user-toggled (auto-sync should not override)
	 */
	markUserToggled(messageId: string): void {
		this.userToggledMessages.add(messageId);
	}

	/**
	 * Check if a reasoning block was user-toggled
	 */
	wasUserToggled(messageId: string): boolean {
		return this.userToggledMessages.has(messageId);
	}

	/**
	 * Clear user-toggled tracking for a reasoning block
	 */
	clearUserToggled(messageId: string): void {
		this.userToggledMessages.delete(messageId);
	}

	getUserToggledKeys(): Iterable<string> {
		return this.userToggledMessages.keys();
	}

	/**
	 * Update display messages
	 */
	setDisplayMessages(messages: DisplayMessage[]): void {
		// Detect thread navigation (reset when changing between existing threads)
		const currentThreadId = untrack(() => this.core.threadId);

		// Reset only on actual navigation between threads
		// NOT on null → threadId (thread creation) or during brief empty states
		if (
			this._lastThreadId !== undefined &&
			currentThreadId !== this._lastThreadId &&
			this._lastThreadId !== null // Don't reset when creating new thread
		) {
			this.messagesFade.reset();
			this._hasEverDisplayedMessages = false;
		}
		this._lastThreadId = currentThreadId;

		this.displayMessages = messages;

		// Only trigger animation on truly first display of messages
		if (messages.length > 0 && !this._hasEverDisplayedMessages) {
			this._hasEverDisplayedMessages = true;

			// Only animate if first messages are real (not optimistic)
			if (!this.messagesFade.hasLoadedOnce) {
				const hasRealMessages = messages.some((m) => !m.metadata?.optimistic);
				if (hasRealMessages) {
					this.messagesFade.markLoaded();
				}
			}
		}
	}

	/**
	 * Set messages ready state (true when query has resolved)
	 */
	setMessagesReady(ready: boolean): void {
		this.messagesReady = ready;
	}

	/**
	 * Set input value
	 */
	setInputValue(value: string): void {
		this.inputValue = value;
	}

	/**
	 * Clear input
	 */
	clearInput(): void {
		this.inputValue = '';
	}

	/**
	 * Add attachments
	 */
	addAttachments(newAttachments: Attachment[]): void {
		this.attachments = [...this.attachments, ...newAttachments];
	}

	/**
	 * Remove attachment at index
	 */
	removeAttachment(index: number): void {
		this.attachments = this.attachments.filter((_, i) => i !== index);
	}

	/**
	 * Clear all attachments
	 */
	clearAttachments(): void {
		this.attachments = [];
		this.attachmentKeys.clear();
		this.nextAttachmentIndex = 0;
	}

	/**
	 * Check if a file with the same name and size already exists
	 */
	hasFile(name: string, size: number): boolean {
		return this.attachments.some(
			(a) => (a.type === 'file' || a.type === 'screenshot') && a.name === name && a.size === size
		);
	}

	/**
	 * Get image dimensions from a file
	 */
	private getImageDimensions(file: File | Blob): Promise<{ width: number; height: number }> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				resolve({ width: img.naturalWidth, height: img.naturalHeight });
				URL.revokeObjectURL(img.src);
			};
			img.onerror = () => {
				resolve({ width: 0, height: 0 });
				URL.revokeObjectURL(img.src);
			};
			img.src = URL.createObjectURL(file);
		});
	}

	/**
	 * Upload a file and add it as an attachment
	 * Progress is tracked automatically
	 * Images are uploaded as-is (the model supports all allowed formats natively).
	 */
	async uploadFile(file: File | Blob, filename?: string): Promise<void> {
		if (!this.uploadConfig) {
			throw new Error('Upload config not provided to ChatUIContext');
		}

		const name = filename ?? (file instanceof File ? file.name : 'file');
		const attachmentIndex = this.nextAttachmentIndex++;
		const key = crypto.randomUUID();
		this.attachmentKeys.set(attachmentIndex, key);

		let width: number | undefined;
		let height: number | undefined;
		const mimeType = file.type;

		// Get dimensions for image metadata (used for dialog sizing)
		if (file.type.startsWith('image/')) {
			const dims = await this.getImageDimensions(file);
			if (dims.width > 0 && dims.height > 0) {
				width = dims.width;
				height = dims.height;
			}
		}

		// Add optimistic attachment with uploading state
		const newAttachment: Attachment = {
			type: 'file',
			name,
			size: file.size,
			mimeType,
			preview: mimeType.startsWith('image/') ? URL.createObjectURL(file) : undefined,
			uploadState: { status: 'uploading', progress: 0 },
			width,
			height
		};

		this.attachments = [...this.attachments, newAttachment];
		const currentIndex = this.attachments.length - 1;

		try {
			const accessKey = this.uploadConfig?.getAccessKey?.();
			const result = await uploadFileWithProgress(
				this.client,
				file,
				name,
				(progress) => {
					// Update progress for this specific attachment
					this.attachments = this.attachments.map((a, i) =>
						i === currentIndex && (a.type === 'file' || a.type === 'screenshot') && a.uploadState
							? { ...a, uploadState: { ...a.uploadState, progress } }
							: a
					);
				},
				this.uploadConfig,
				width && height ? { width, height } : undefined,
				accessKey
			);

			// Mark as success
			this.attachments = this.attachments.map((a, i) =>
				i === currentIndex
					? {
							...a,
							url: result.url,
							uploadState: { status: 'success' as const, progress: 100, fileId: result.fileId }
						}
					: a
			);
		} catch (error) {
			// Remove failed attachment and show toast
			this.attachments = this.attachments.filter((_, i) => i !== currentIndex);
			toast.error(`Failed to upload "${name}"`, {
				description: error instanceof Error ? error.message : 'Upload failed'
			});
		}
	}

	/**
	 * Upload a screenshot blob
	 */
	async uploadScreenshot(
		blob: Blob,
		filename: string,
		dimensions?: { width: number; height: number }
	): Promise<void> {
		if (!this.uploadConfig) {
			throw new Error('Upload config not provided to ChatUIContext');
		}

		const attachmentIndex = this.nextAttachmentIndex++;
		const key = crypto.randomUUID();
		this.attachmentKeys.set(attachmentIndex, key);

		// Add optimistic attachment with uploading state
		const newAttachment: Attachment = {
			type: 'screenshot',
			name: filename,
			size: blob.size,
			mimeType: blob.type,
			preview: URL.createObjectURL(blob),
			uploadState: { status: 'uploading', progress: 0 },
			width: dimensions?.width,
			height: dimensions?.height
		};

		this.attachments = [...this.attachments, newAttachment];
		const currentIndex = this.attachments.length - 1;

		try {
			const accessKey = this.uploadConfig?.getAccessKey?.();
			const result = await uploadFileWithProgress(
				this.client,
				blob,
				filename,
				(progress) => {
					this.attachments = this.attachments.map((a, i) =>
						i === currentIndex && (a.type === 'file' || a.type === 'screenshot') && a.uploadState
							? { ...a, uploadState: { ...a.uploadState, progress } }
							: a
					);
				},
				this.uploadConfig,
				dimensions,
				accessKey
			);

			// Mark as success
			this.attachments = this.attachments.map((a, i) =>
				i === currentIndex
					? {
							...a,
							url: result.url,
							uploadState: { status: 'success' as const, progress: 100, fileId: result.fileId }
						}
					: a
			);
		} catch (error) {
			// Remove failed attachment and show toast
			this.attachments = this.attachments.filter((_, i) => i !== currentIndex);
			toast.error(`Failed to upload "${filename}"`, {
				description: error instanceof Error ? error.message : 'Upload failed'
			});
		}
	}

	/**
	 * Reset state for navigation transitions (e.g., when returning to overview)
	 * This ensures clean state when the chat view slides out
	 */
	resetForNavigation(): void {
		this.messagesFade.reset();
		this._hasEverDisplayedMessages = false;
		this.displayMessages = [];
	}

	/**
	 * Get the last message
	 */
	get lastMessage(): DisplayMessage | undefined {
		return this.displayMessages.at(-1);
	}

	/**
	 * Check if last message is from user
	 */
	get lastMessageIsUser(): boolean {
		return this.lastMessage?.role === 'user';
	}

	/**
	 * Check if chat is empty
	 */
	get isEmpty(): boolean {
		return this.displayMessages.length === 0;
	}

	/**
	 * Check if any upload is in progress
	 */
	get hasUploadingFiles(): boolean {
		return this.attachments.some(
			(a) => (a.type === 'file' || a.type === 'screenshot') && a.uploadState?.status === 'uploading'
		);
	}

	/**
	 * Check if message can be sent
	 */
	get canSend(): boolean {
		return !this.hasUploadingFiles && !!this.inputValue.trim();
	}

	/**
	 * Check if any assistant message is currently streaming
	 * Uses displayMessages which is always synced from query
	 */
	get isStreaming(): boolean {
		return this.displayMessages.some(
			(m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
		);
	}

	/**
	 * Check if chat is currently processing (sending, awaiting stream, or streaming)
	 * Single source of truth for input blocking logic
	 */
	get isProcessing(): boolean {
		return this.core.isSending || this.core.isAwaitingStream || this.isStreaming;
	}

	/**
	 * Get all successfully uploaded file IDs
	 */
	get uploadedFileIds(): string[] {
		return this.attachments
			.filter(
				(a): a is Extract<Attachment, { type: 'file' | 'screenshot' }> =>
					(a.type === 'file' || a.type === 'screenshot') && a.uploadState?.status === 'success'
			)
			.map((a) => a.uploadState!.fileId!)
			.filter(Boolean);
	}
}

const CHAT_UI_KEY = Symbol('chat-ui');

/**
 * Set chat UI context
 */
export function setChatUIContext(context: ChatUIContext): void {
	setContext(CHAT_UI_KEY, context);
}

/**
 * Get chat UI context
 * @throws Error if used outside of ChatRoot
 */
export function getChatUIContext(): ChatUIContext {
	const context = getContext<ChatUIContext>(CHAT_UI_KEY);

	if (!context) {
		throw new Error('Chat UI components must be used within ChatRoot');
	}

	return context;
}

/**
 * Try to get chat UI context (returns undefined if not found)
 */
export function tryGetChatUIContext(): ChatUIContext | undefined {
	return getContext<ChatUIContext>(CHAT_UI_KEY);
}
