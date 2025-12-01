/**
 * Chat UI Context
 *
 * Provides context for chat UI components to access shared state and configuration.
 * Uses Svelte's native context API with a class-based approach for type safety.
 */

import { getContext, setContext, untrack } from 'svelte';
import { toast } from 'svelte-sonner';
import type { ConvexClient } from 'convex/browser';
import type { ChatCore } from '../core/ChatCore.svelte.js';
import type { DisplayMessage, Attachment } from '../core/types.js';
import { uploadFileWithProgress } from '../core/FileUploader.js';
import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.js';

/**
 * Configuration for file uploads
 */
export interface UploadConfig {
	generateUploadUrl: Parameters<ConvexClient['mutation']>[0];
	saveUploadedFile: Parameters<ConvexClient['action']>[0];
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

	/** UI state: which reasoning accordions are open */
	reasoningOpenState = $state<Map<string, boolean>>(new Map());

	/** Processed messages with display fields (set by ChatMessages) */
	displayMessages = $state<DisplayMessage[]>([]);

	/** Fade animation state for messages */
	readonly messagesFade = new FadeOnLoad<DisplayMessage[]>();

	/** Current input value */
	inputValue = $state('');

	/** Attachments for current message - keyed by unique ID for progress updates */
	attachments = $state<Attachment[]>([]);

	/** Internal map for tracking attachment keys (for progress updates) */
	private attachmentKeys = new Map<number, string>();
	private nextAttachmentIndex = 0;

	/** Tracks if we've ever displayed messages in this session */
	private _hasEverDisplayedMessages = false;

	/** Last known thread ID for detecting navigation */
	private _lastThreadId: string | null | undefined = undefined;

	constructor(core: ChatCore, client: ConvexClient, uploadConfig?: UploadConfig) {
		this.core = core;
		this.client = client;
		this.uploadConfig = uploadConfig;
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
	 * Upload a file and add it as an attachment
	 * Progress is tracked automatically
	 */
	async uploadFile(file: File | Blob, filename?: string): Promise<void> {
		if (!this.uploadConfig) {
			throw new Error('Upload config not provided to ChatUIContext');
		}

		const name = filename ?? (file instanceof File ? file.name : 'file');
		const attachmentIndex = this.nextAttachmentIndex++;
		const key = crypto.randomUUID();
		this.attachmentKeys.set(attachmentIndex, key);

		// Add optimistic attachment with uploading state
		const newAttachment: Attachment = {
			type: 'file',
			name,
			size: file.size,
			mimeType: file.type,
			preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
			uploadState: { status: 'uploading', progress: 0 }
		};

		this.attachments = [...this.attachments, newAttachment];
		const currentIndex = this.attachments.length - 1;

		try {
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
				this.uploadConfig
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
	async uploadScreenshot(blob: Blob, filename: string): Promise<void> {
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
			uploadState: { status: 'uploading', progress: 0 }
		};

		this.attachments = [...this.attachments, newAttachment];
		const currentIndex = this.attachments.length - 1;

		try {
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
				this.uploadConfig
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
