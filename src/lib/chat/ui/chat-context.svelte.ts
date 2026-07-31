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
import type { ChatCore } from '../core/chat-core.svelte.ts';
import type { DisplayMessage, Attachment, MessageRole, UploadState } from '../core/types.js';
import { uploadFileWithProgress, UploadError } from '../core/file-uploader.js';
import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.ts';

/**
 * Message alignment - controls which side messages appear on
 */
export type ChatAlignment = 'left' | 'right';

/**
 * A ready-to-send upload: what the transport receives after any client-side
 * preprocessing. Retained per attachment so a retry repeats the same transfer
 * instead of redoing the preprocessing, which is neither free nor idempotent
 * (image re-encoding renames the file and changes its bytes).
 */
type UploadJob = {
	blob: File | Blob;
	filename: string;
	dimensions?: { width: number; height: number };
};

/** A canceled upload, which the user caused and does not need to be told about. */
function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Configuration for file uploads
 */
export interface UploadConfig {
	generateUploadUrl: Parameters<ConvexClient['mutation']>[0];
	saveUploadedFile: Parameters<ConvexClient['action']>[0];
	/** Locale for translated error messages */
	locale?: string;
	/**
	 * Tolgee translate function supplied by the parent Svelte component (this
	 * is a `.svelte.ts` class with no `$t` rune). Used to localize upload error
	 * toasts; falls back to English when not provided. The param value type
	 * matches Tolgee's `DefaultParamType` so the wrapper passes through to `$t`.
	 */
	translate?: (key: string, params?: Record<string, string | number | bigint | Date>) => string;
	/** Optional access key provider for file control */
	getAccessKey?: () => string | undefined;
	/** Provider for extra args to pass to generateUploadUrl (e.g., anonymousUserId for rate limiting) */
	getGenerateUploadUrlArgs?: () => Record<string, unknown>;
	/**
	 * Optional action that returns the text of a stored attachment for the
	 * preview dialog. Required to render markdown/text/code previews of
	 * already-sent attachments (no local blob); without it the preview falls
	 * back to the raw iframe. Receives `{ url, locale, ...getGenerateUploadUrlArgs() }`.
	 */
	getAttachmentText?: Parameters<ConvexClient['action']>[0];
}

/**
 * The part of the app's in-flight upload registry this context reports to.
 * Structural on purpose, so the chat module stays independent of the app hook.
 */
export interface ActiveUploadsRegistry {
	claim(owner: object): void;
	release(owner: object): void;
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

	/** Attachments for current message. Each entry's `key` is the stable id
	 * used by upload methods to apply progress/success/error updates by value
	 * rather than by array index. */
	attachments = $state<Attachment[]>([]);

	/** Cancels the in-flight upload of an attachment, keyed by its stable `key`. */
	private readonly uploadAborters = new SvelteMap<string, AbortController>();

	/**
	 * Where to report a transfer in progress, so navigating away asks first.
	 *
	 * Reported from here rather than watched from a component: this context
	 * outlives the chat rendering it. Closing the support panel unmounts the chat
	 * while the transfer keeps running, and the screenshot flow uploads through
	 * this context with no chat mounted at all, so a component-scoped claim would
	 * be given up, or never taken, while the file is on the wire.
	 */
	private readonly activeUploads: ActiveUploadsRegistry | null;

	/**
	 * The exact payload each failed attachment would need to try again. Held
	 * because retrying from the picked file is not equivalent: images are
	 * re-encoded before upload, and screenshots never had a File to begin with.
	 * Only kept while the attachment is present, so a discarded blob is freed.
	 */
	private readonly retryJobs = new SvelteMap<string, UploadJob>();

	/** The one composer mounted inside this ChatRoot. */
	private composerFocus?: () => void;

	/** Tracks if we've ever displayed messages in this session */
	private _hasEverDisplayedMessages = false;

	/** Last known thread ID for detecting navigation */
	private _lastThreadId: string | null | undefined = undefined;

	constructor(
		core: ChatCore,
		client: ConvexClient,
		uploadConfig?: UploadConfig,
		userAlignment: ChatAlignment = 'right',
		activeUploads: ActiveUploadsRegistry | null = null
	) {
		this.core = core;
		this.client = client;
		this.uploadConfig = uploadConfig;
		this.userAlignment = userAlignment;
		this.activeUploads = activeUploads;
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
			// Attachments belong to the thread they were picked in. Every surface
			// reuses one context across threads and swaps only the text draft, so
			// without this a file follows the user and is sent in the wrong
			// conversation — and a failed one blocks sending there. Also cancels
			// any transfer still running for the thread being left.
			this.clearAttachments();
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

	registerComposerFocus(handler: () => void): void {
		this.composerFocus = handler;
	}

	unregisterComposerFocus(handler: () => void): void {
		if (this.composerFocus === handler) this.composerFocus = undefined;
	}

	focusComposer(): void {
		this.composerFocus?.();
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
	 * Revoke an attachment's blob preview URL (no-op for non-blob previews).
	 * Optimistic clones strip `preview` (see `sanitizeAttachmentsForClone`),
	 * so revoking when an attachment leaves the composer cannot break the
	 * optimistic message render, which falls back to the uploaded `url`.
	 */
	private revokePreview(attachment: Attachment): void {
		if ('preview' in attachment && attachment.preview?.startsWith('blob:')) {
			URL.revokeObjectURL(attachment.preview);
		}
	}

	/**
	 * Cancel an attachment's in-flight upload and drop everything held for it.
	 * Attachments handed in from outside may have no `key` and never started an
	 * upload, so a missing entry is normal rather than an error.
	 */
	private releaseUpload(attachment: Attachment): void {
		const key = 'key' in attachment ? attachment.key : undefined;
		if (!key) return;
		this.uploadAborters.get(key)?.abort();
		this.uploadAborters.delete(key);
		this.retryJobs.delete(key);
	}

	/**
	 * Remove attachment at index
	 */
	removeAttachment(index: number): void {
		const removed = this.attachments[index];
		if (removed) {
			this.releaseUpload(removed);
			this.revokePreview(removed);
		}
		this.attachments = this.attachments.filter((_, i) => i !== index);
	}

	/**
	 * Clear all attachments
	 */
	clearAttachments(): void {
		for (const attachment of this.attachments) {
			this.releaseUpload(attachment);
			this.revokePreview(attachment);
		}
		this.attachments = [];
	}

	/**
	 * Release resources held by this context. Call on unmount of the owning
	 * component so blob preview URLs of unsent attachments do not leak until
	 * the document unloads.
	 */
	dispose(): void {
		this.clearAttachments();
		// clearAttachments aborts the transfers, but their handlers run later; the
		// context is going away, so it cannot be the thing that lets go.
		this.activeUploads?.release(this);
	}

	/**
	 * Check if a file with the same name and size already exists
	 */
	hasFile(name: string, size: number): boolean {
		// Match either current name+size OR the pre-preprocessing source values.
		// Without the second branch, image attachments would lose dedup after
		// they're renamed to .webp on upload — the user could re-paste the same
		// source image and get duplicate uploads.
		return this.attachments.some(
			(a) =>
				(a.type === 'file' || a.type === 'screenshot') &&
				((a.name === name && a.size === size) || (a.sourceName === name && a.sourceSize === size))
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
	 * Images are re-encoded before upload when the caller passes `preprocess`
	 * (ChatInput does: it resizes and converts to WebP). Non-images upload as-is.
	 */
	async uploadFile(
		file: File | Blob,
		filename?: string,
		options?: {
			/**
			 * Optional async transform applied between placeholder insertion and the
			 * actual upload. Used by ChatInput to route image attachments through
			 * the WebP encoder. The placeholder is inserted synchronously so
			 * `hasFile`, `MAX_ATTACHMENTS`, and `canSend` see the in-progress
			 * attachment for the entire preprocess + upload window.
			 */
			preprocess?: (input: File | Blob) => Promise<{
				blob: Blob;
				mimeType: string;
				filename?: string;
				width?: number;
				height?: number;
			}>;
		}
	): Promise<void> {
		if (!this.uploadConfig) {
			throw new Error('Upload config not provided to ChatUIContext');
		}

		const initialName = filename ?? (file instanceof File ? file.name : 'file');
		// Stable identity used to update/remove this attachment by value rather
		// than by array index. User removals or other concurrent uploads shift
		// the index, so a captured `currentIndex` would target the wrong row.
		const key = crypto.randomUUID();

		// Synchronously insert the placeholder BEFORE any await so concurrent
		// callers (e.g. handleFilesAdded looping over a batch) see the limit
		// and dedup state immediately.
		const isImageType = file.type.startsWith('image/');
		const initialPreview = isImageType ? URL.createObjectURL(file) : undefined;
		const placeholder: Attachment = {
			type: 'file',
			key,
			name: initialName,
			size: file.size,
			mimeType: file.type,
			preview: initialPreview,
			// Retain the original blob for non-image files (bounded by the 5MB
			// upload cap) so the attachment preview can read their text locally,
			// with no round-trip. Images are omitted: they are re-encoded on
			// upload and never use the text preview.
			file: !isImageType && file instanceof File ? file : undefined,
			uploadState: { status: 'uploading', progress: 0 },
			// Source metadata persists across the rename in preprocess so dedup
			// still matches when the user re-pastes the same image.
			sourceName: initialName,
			sourceSize: file.size
		};
		this.attachments = [...this.attachments, placeholder];

		try {
			let uploadBlob: File | Blob = file;
			let uploadName = initialName;
			let uploadMime = file.type;
			let width: number | undefined;
			let height: number | undefined;

			if (options?.preprocess) {
				const processed = await options.preprocess(file);
				uploadBlob = processed.blob;
				uploadMime = processed.mimeType;
				if (processed.filename) uploadName = processed.filename;
				width = processed.width;
				height = processed.height;
				// Reflect post-process metadata on the placeholder so the UI shows
				// the final size and name during the actual upload.
				this.attachments = this.attachments.map((a) =>
					'key' in a && a.key === key
						? { ...a, name: uploadName, mimeType: uploadMime, size: uploadBlob.size }
						: a
				);
			}

			// Read dimensions only when preprocess didn't supply them. Image-typed
			// files paths from preprocess always do; SVG/animated-GIF passthrough
			// reports valid dims too. This is the legacy fallback.
			if (uploadMime.startsWith('image/') && (width === undefined || height === undefined)) {
				const dims = await this.getImageDimensions(uploadBlob);
				if (dims.width > 0 && dims.height > 0) {
					width = dims.width;
					height = dims.height;
				}
			}
			if (width && height) {
				this.attachments = this.attachments.map((a) =>
					'key' in a && a.key === key ? { ...a, width, height } : a
				);
			}

			// Preprocessing and dimension reading are awaited above and cannot be
			// canceled, so the user may have discarded the attachment by now.
			// Starting the transfer would upload a file nothing references and
			// leave map entries behind for a key that is gone.
			if (!this.attachments.some((a) => 'key' in a && a.key === key)) {
				this.retryJobs.delete(key);
				return;
			}

			await this.runUpload(key, {
				blob: uploadBlob,
				filename: uploadName,
				dimensions: width && height ? { width, height } : undefined
			});
		} catch (error) {
			// A failure before the transfer (image preprocessing, dimension
			// reading) leaves nothing to retry, and preprocessing already throws
			// its own translated message. Those keep the old behavior: drop the
			// attachment, say why once.
			//
			// Unless the user got there first: preprocessing cannot be canceled,
			// so it may still reject long after the chip was discarded, and
			// reporting a failure for a file nobody is waiting on is noise.
			const stillPresent = this.attachments.some((a) => 'key' in a && a.key === key);
			this.discardAttachment(key);
			if (isAbortError(error) || !stillPresent) return;
			const translate = this.uploadConfig?.translate;
			toast.error(
				translate?.('chat.error.upload_failed', { filename: initialName }) ??
					`Failed to upload "${initialName}"`,
				{ description: error instanceof Error ? error.message : undefined }
			);
		}
	}

	/**
	 * Run one upload attempt for an existing attachment and record the outcome
	 * on it. Shared by the file path, the screenshot path, and retry, so all
	 * three produce the same states.
	 *
	 * Never throws: a failure becomes a visible, retryable attachment state
	 * rather than an exception the caller has to translate again.
	 */
	private async runUpload(key: string, job: UploadJob): Promise<void> {
		if (!this.uploadConfig) return;

		// Starting an attempt cancels any earlier one for the same attachment, so
		// a double-click on retry cannot leave a request running unattended.
		this.uploadAborters.get(key)?.abort();
		const aborter = new AbortController();
		this.uploadAborters.set(key, aborter);
		this.retryJobs.set(key, job);
		this.activeUploads?.claim(this);
		this.patchAttachment(key, { uploadState: { status: 'uploading', progress: 0 } });

		/**
		 * Whether this attempt is still the current one. A superseded attempt
		 * must not write state or clear the live attempt's aborter; without this
		 * a slow first try could stamp its failure over a newer success.
		 */
		const isCurrent = () => this.uploadAborters.get(key) === aborter;

		try {
			const result = await uploadFileWithProgress(
				this.client,
				job.blob,
				job.filename,
				(progress) => {
					if (isCurrent()) this.patchUploadState(key, (state) => ({ ...state, progress }));
				},
				this.uploadConfig,
				job.dimensions,
				this.uploadConfig.getAccessKey?.(),
				aborter.signal
			);

			if (!isCurrent()) return;
			this.patchAttachment(key, {
				url: result.url,
				uploadState: { status: 'success', progress: 100, fileId: result.fileId }
			});
			// The bytes are on the server now; holding them would pin memory for
			// an attachment that can no longer fail.
			this.retryJobs.delete(key);
		} catch (error) {
			// Cancelation is not a failure: removeAttachment/clearAttachments
			// already took the attachment away, so there is no state to write.
			if (isAbortError(error) || !isCurrent()) return;
			// The tile shows a translated cause; the specifics that identify the
			// failure — HTTP status, and the Convex message kept in `cause` — have
			// no place in the UI but are what makes a report actionable.
			console.error('[ChatUIContext] Upload failed:', error);
			this.patchAttachment(key, {
				uploadState: {
					status: 'error',
					progress: 0,
					error: error instanceof UploadError ? error.code : 'server'
				}
			});
		} finally {
			if (isCurrent()) this.uploadAborters.delete(key);
			// Unconditional: a superseded attempt still has to let go, and by now
			// the map holds only whatever is genuinely still on the wire.
			if (this.uploadAborters.size === 0) this.activeUploads?.release(this);
		}
	}

	/**
	 * Try a failed upload again with the exact payload of the first attempt.
	 * No-op when the attachment has no retained job, which is the case for
	 * failures that happened before the transfer.
	 */
	retryUpload(index: number): void {
		const attachment = this.attachments[index];
		if (!attachment || !('key' in attachment) || !attachment.key) return;
		const job = this.retryJobs.get(attachment.key);
		if (!job) return;
		void this.runUpload(attachment.key, job);
	}

	/** Apply a partial update to the attachment with this key. */
	private patchAttachment(key: string, patch: Partial<Attachment>): void {
		this.attachments = this.attachments.map((a) =>
			'key' in a && a.key === key ? ({ ...a, ...patch } as Attachment) : a
		);
	}

	/** Update the upload state of the attachment with this key, if it has one. */
	private patchUploadState(key: string, next: (state: UploadState) => UploadState): void {
		this.attachments = this.attachments.map((a) =>
			'key' in a && a.key === key && (a.type === 'file' || a.type === 'screenshot') && a.uploadState
				? { ...a, uploadState: next(a.uploadState) }
				: a
		);
	}

	/** Remove an attachment by key and release everything held for it. */
	private discardAttachment(key: string): void {
		const attachment = this.attachments.find((a) => 'key' in a && a.key === key);
		if (attachment) {
			this.releaseUpload(attachment);
			this.revokePreview(attachment);
		}
		this.attachments = this.attachments.filter((a) => !('key' in a) || a.key !== key);
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

		const key = crypto.randomUUID();

		// Add optimistic attachment with uploading state
		const newAttachment: Attachment = {
			type: 'screenshot',
			key,
			name: filename,
			size: blob.size,
			mimeType: blob.type,
			preview: URL.createObjectURL(blob),
			uploadState: { status: 'uploading', progress: 0 },
			width: dimensions?.width,
			height: dimensions?.height
		};

		this.attachments = [...this.attachments, newAttachment];

		// No preprocessing here: the blob and its dimensions are already what
		// gets uploaded, so they double as the retry payload unchanged.
		await this.runUpload(key, { blob, filename, dimensions });
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
	 * Whether any attachment failed to upload.
	 *
	 * Blocks sending, because only successful uploads reach the backend while
	 * the whole attachment list is rendered optimistically: sending anyway would
	 * show the user a file that was never stored. The inline error offers retry
	 * and discard, so this is a prompt to decide, not a dead end.
	 */
	get hasFailedUploads(): boolean {
		return this.attachments.some(
			(a) => (a.type === 'file' || a.type === 'screenshot') && a.uploadState?.status === 'error'
		);
	}

	/**
	 * Check if message can be sent
	 */
	get canSend(): boolean {
		return !this.hasUploadingFiles && !this.hasFailedUploads && !!this.inputValue.trim();
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
