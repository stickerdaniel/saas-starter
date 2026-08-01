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
import type {
	AttachmentsByThread,
	ChatAttachmentStore
} from '../core/chat-attachment-store.svelte.ts';
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
	/**
	 * Who the stored file belongs to, read when the file was picked.
	 *
	 * Every surface derives this from the thread it is showing, and the transfer
	 * can start long after the pick: an image spends its encoding time first, and
	 * a retry happens whenever the user gets to it. Reading it at that point would
	 * file the attachment under whatever thread is on screen by then.
	 */
	accessKey?: string;
};

/** Ranks for a transfer that is over, and one that has to start again, against
 * the 0-100 progress of any still running. */
const SETTLED_RANK = 101;
const FAILED_RANK = -1;

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
	/**
	 * Where uploaded attachments are kept so a reload does not lose them.
	 *
	 * Carried here rather than as its own constructor argument because only a
	 * configured upload can produce anything worth keeping: what survives is the
	 * reference to a file that is already stored.
	 */
	attachmentStore?: ChatAttachmentStore;
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

	/**
	 * Attachments of threads the user stepped away from, by thread id.
	 *
	 * Deliberately unbounded: evicting one would be the silent loss this exists
	 * to prevent. What it can grow to is bounded by the user's own picking, one
	 * file dialog at a time, and a retry payload is only retained while its
	 * attachment can still fail. Everything here is released on dispose.
	 */
	private readonly parked = new SvelteMap<string, Attachment[]>();

	/** Cancels the in-flight upload of an attachment, keyed by its stable `key`. */
	private readonly uploadAborters = new SvelteMap<string, AbortController>();

	/**
	 * Where to report work in progress, so navigating away asks first.
	 *
	 * Reported from here rather than watched from a component: this context
	 * outlives the chat rendering it. Closing the support panel unmounts the chat
	 * while the work keeps running, and the screenshot flow uploads through this
	 * context with no chat mounted at all, so a component-scoped claim would be
	 * given up, or never taken, while the file is still going somewhere.
	 */
	private readonly activeUploads: ActiveUploadsRegistry | null;

	/**
	 * Attachments the user is still waiting on, by key.
	 *
	 * Wider than `uploadAborters`, which only covers the transfer. An image
	 * spends a visible stretch in the WebP encoder first, with the tile already
	 * showing progress, and losing the page there loses the pick just the same.
	 * Also narrower where it matters: a discarded attachment leaves this set at
	 * once, even though the request it started may take a while to unwind.
	 */
	private readonly pendingUploads = new SvelteSet<string>();

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

	/**
	 * Whether the surface this belongs to is gone.
	 *
	 * Read only by `persist`, so tearing the context down is not mistaken for
	 * the user emptying their composer: `dispose` drops every attachment, and
	 * saving that would erase exactly what a reload is supposed to bring back.
	 */
	private disposed = false;

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

		// Composers a reload took away arrive parked, under the thread they were
		// left in. From here on nothing knows the difference between one that came
		// off disk and one the user stepped away from a moment ago, and each waits
		// to be walked back into.
		for (const [threadId, attachments] of uploadConfig?.attachmentStore?.read() ?? []) {
			this.parked.set(threadId, attachments);
		}
		// The thread already on screen claims its own here rather than waiting for
		// the first render. Waiting would leave its own attachments parked under
		// the id it is standing in, and a save before then writes the live list
		// over them: the screenshot flow uploads through this context with no chat
		// mounted at all, so that first render may never come.
		this.adoptParked(untrack(() => core.threadId));
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
		if (this._lastThreadId === undefined) {
			// First sight of any thread here. After a reload this thread's composer
			// is parked, restored from storage by the constructor, and the live one
			// is empty, so the same take-back that serves a warm thread serves this.
			this.adoptParked(currentThreadId);
		} else if (currentThreadId !== this._lastThreadId) {
			if (this._lastThreadId === null) {
				this.adoptParked(currentThreadId);
			} else {
				this.messagesFade.reset();
				this._hasEverDisplayedMessages = false;
				this.parkAttachments(this._lastThreadId, currentThreadId);
			}
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
		this.persist();
	}

	/**
	 * Write down what every composer is holding, so a reload can hand it back.
	 *
	 * Called from each method that changes either list. Only settled uploads
	 * reach storage, so the progress of a running one passes through here
	 * without producing a write.
	 */
	private persist(): void {
		const store = this.uploadConfig?.attachmentStore;
		if (!store || this.disposed) return;
		// Handed straight to the store, never rendered.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const snapshot: AttachmentsByThread = new Map(this.parked);
		// Same empty key the parked lists use for a conversation with no id yet.
		snapshot.set(untrack(() => this.core.threadId) ?? '', this.attachments);
		store.write(snapshot);
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
		// Straight away, not when the aborted attempt unwinds: an abort cannot
		// stop a Convex mutation already in flight, so waiting for it would keep
		// asking about a file the user has already thrown away.
		this.settlePending(key);
	}

	/** Start counting an attachment as work in progress. Idempotent. */
	private markPending(key: string): void {
		this.pendingUploads.add(key);
		this.activeUploads?.claim(this);
	}

	/** Stop counting it, and let go once nothing is left. Idempotent. */
	private settlePending(key: string): void {
		this.pendingUploads.delete(key);
		if (this.pendingUploads.size === 0) this.activeUploads?.release(this);
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
		this.persist();
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
		this.persist();
	}

	/**
	 * Hand the composer over from one thread to another.
	 *
	 * Attachments belong to the thread they were picked in. Every surface reuses
	 * one context across threads and swaps only the text draft, so a file left
	 * in place would be sent in the wrong conversation, and a failed one would
	 * block sending there. Set aside rather than thrown away: the transfer keeps
	 * running, and the composer looks the same on the way back, so a switch mid
	 * transfer no longer costs the file.
	 */
	private parkAttachments(leaving: string, entering: string | null): void {
		if (this.attachments.length > 0) this.parked.set(leaving, this.attachments);
		// A thread that has none is a thread with an empty composer, so the
		// lookup miss is the answer rather than a case to handle. A conversation
		// with no id yet is filed under the empty key, which no real thread can
		// collide with.
		const key = entering ?? '';
		this.attachments = this.parked.get(key) ?? [];
		this.parked.delete(key);
		this.persist();
	}

	/**
	 * Take back what was parked for a thread that is only now getting its id.
	 *
	 * Starting a conversation is not a move to another one, so the composer keeps
	 * what it holds. It can still land on a thread with something parked: leaving
	 * an unused warm thread parks under its id, and asking for a new conversation
	 * hands the very same warm thread back out. Without this the attachment would
	 * be stranded under an id the user is standing in, invisible and still
	 * transferring.
	 */
	private adoptParked(threadId: string | null): void {
		const key = threadId ?? '';
		const parked = this.parked.get(key);
		if (!parked) return;
		this.parked.delete(key);

		// The composer's own duplicate check could only see the live list while
		// this was parked, so the same file can be in both. Whichever copy got
		// further stays, because the loser costs the user a retry it did not need.
		// Indices rather than identities: reading `attachments` hands out proxies,
		// so comparing the objects would not reliably match.
		const supersededLive = this.attachments.map(() => false);
		const adopted: Attachment[] = [];
		for (const candidate of parked) {
			const rivalIndex = this.attachments.findIndex(
				(live, index) => !supersededLive[index] && ChatUIContext.isSameFile(candidate, live)
			);
			const rival = rivalIndex === -1 ? undefined : this.attachments[rivalIndex];
			if (!rival) {
				adopted.push(candidate);
				continue;
			}
			// Ties go to the parked copy, which has the head start on its transfer.
			if (ChatUIContext.uploadProgressRank(candidate) >= ChatUIContext.uploadProgressRank(rival)) {
				supersededLive[rivalIndex] = true;
				this.releaseUpload(rival);
				this.revokePreview(rival);
				adopted.push(candidate);
			} else {
				this.releaseUpload(candidate);
				this.revokePreview(candidate);
			}
		}

		// Adopted first: they were picked before whatever is in the composer now.
		// The result can sit above the pick-time attachment cap, which is the
		// lesser evil. The cap keeps one pick reasonable; dropping a file the user
		// picked, to hold a number they never see, is the loss this path exists to
		// avoid. They are all destined for this thread, and any one can be removed.
		this.attachments = [
			...adopted,
			...this.attachments.filter((_, index) => !supersededLive[index])
		];
		this.persist();
	}

	/**
	 * Release resources held by this context. Call on unmount of the owning
	 * component so blob preview URLs of unsent attachments do not leak until
	 * the document unloads.
	 */
	dispose(): void {
		// Before anything is dropped. What follows empties both lists, and saving
		// that would erase the composers this surface is supposed to hand back the
		// next time it is built. Leaving is not the same as letting go.
		this.disposed = true;
		// Parked attachments hold aborters and blob previews just like live ones,
		// and no thread switch is coming to pick them up any more.
		for (const attachments of this.parked.values()) {
			for (const attachment of attachments) {
				this.releaseUpload(attachment);
				this.revokePreview(attachment);
			}
		}
		this.parked.clear();
		this.clearAttachments();
		// The surface is gone for good, so nothing is left that could report an
		// outcome, whatever is still unwinding.
		this.pendingUploads.clear();
		this.activeUploads?.release(this);
	}

	/**
	 * How an attachment answers "is this the same file", as name and size.
	 *
	 * Two answers, because preprocessing renames an image to .webp and changes
	 * its bytes: without the pre-preprocessing pair, re-pasting the same source
	 * image would slip past dedup and upload twice.
	 */
	private static fileIdentity(attachment: Attachment): string[] {
		if (attachment.type !== 'file' && attachment.type !== 'screenshot') return [];
		const identities = [`${attachment.name}:${attachment.size}`];
		if (attachment.sourceName !== undefined && attachment.sourceSize !== undefined) {
			identities.push(`${attachment.sourceName}:${attachment.sourceSize}`);
		}
		return identities;
	}

	/** Whether two attachments are the same picked file. */
	private static isSameFile(a: Attachment, b: Attachment): boolean {
		const other = ChatUIContext.fileIdentity(b);
		return ChatUIContext.fileIdentity(a).some((identity) => other.includes(identity));
	}

	/**
	 * How far an attachment got, so the better of two copies of one file wins.
	 *
	 * A stored file beats one still moving, which beats a failure the user would
	 * have to retry. Between two that are still moving the percentage decides:
	 * ranking them equal would let a stalled transfer cancel one at 99%. An
	 * attachment handed in from outside has no upload state and nothing pending,
	 * so it counts as settled.
	 */
	private static uploadProgressRank(attachment: Attachment): number {
		const state = 'uploadState' in attachment ? attachment.uploadState : undefined;
		if (!state || state.status === 'success') return SETTLED_RANK;
		if (state.status === 'error') return FAILED_RANK;
		return state.progress;
	}

	/**
	 * Check if a file with the same name and size already exists
	 */
	hasFile(name: string, size: number): boolean {
		const picked = `${name}:${size}`;
		return this.attachments.some((a) => ChatUIContext.fileIdentity(a).includes(picked));
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
		// Before the first await: the tile already shows progress, so leaving now
		// costs the user the same file whether or not the transfer has started.
		this.markPending(key);
		// Read here too, for the same reason: this is the thread the file was
		// picked in, and encoding can outlast the user's stay in it.
		const accessKey = this.uploadConfig.getAccessKey?.();

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
				this.patchAttachment(key, {
					name: uploadName,
					mimeType: uploadMime,
					size: uploadBlob.size
				});
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
				this.patchAttachment(key, { width, height });
			}

			// Preprocessing and dimension reading are awaited above and cannot be
			// canceled, so the user may have discarded the attachment by now.
			// Starting the transfer would upload a file nothing references and
			// leave map entries behind for a key that is gone.
			if (!this.findAttachment(key)) {
				this.retryJobs.delete(key);
				return;
			}

			await this.runUpload(key, {
				blob: uploadBlob,
				filename: uploadName,
				dimensions: width && height ? { width, height } : undefined,
				accessKey
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
			const stillPresent = this.findAttachment(key) !== undefined;
			this.discardAttachment(key);
			if (isAbortError(error) || !stillPresent) return;
			const translate = this.uploadConfig?.translate;
			toast.error(
				translate?.('chat.error.upload_failed', { filename: initialName }) ??
					`Failed to upload "${initialName}"`,
				{ description: error instanceof Error ? error.message : undefined }
			);
		} finally {
			// Every exit above already settles this key one way or another; saying
			// so here too keeps the claim from outliving the attempt if a path is
			// ever added that forgets.
			this.settlePending(key);
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
		// Also for a retry, which starts here rather than in uploadFile.
		this.markPending(key);
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
				job.accessKey,
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
			// Only the live attempt settles the attachment: a superseded one is
			// finishing behind a newer transfer that is still running.
			if (isCurrent()) {
				this.uploadAborters.delete(key);
				this.settlePending(key);
			}
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

	/**
	 * Rewrite every list holding this attachment, the live one and any parked.
	 *
	 * An upload outlives the composer showing it: switching threads parks its
	 * attachment while the transfer keeps running. Writing only through the live
	 * list would drop the outcome of a transfer that lands while its thread is
	 * parked, leaving a tile loading forever for a file that is already stored.
	 */
	private rewriteLists(key: string, rewrite: (list: Attachment[]) => Attachment[]): void {
		const holds = (list: Attachment[]) => list.some((a) => 'key' in a && a.key === key);
		if (holds(this.attachments)) this.attachments = rewrite(this.attachments);
		// Bounded by the threads the user stepped away from with something open.
		for (const [threadId, list] of this.parked) {
			if (!holds(list)) continue;
			const next = rewrite(list);
			if (next.length > 0) this.parked.set(threadId, next);
			else this.parked.delete(threadId);
		}
		this.persist();
	}

	/** The attachment with this key, live or parked. */
	private findAttachment(key: string): Attachment | undefined {
		const match = (a: Attachment) => 'key' in a && a.key === key;
		const live = this.attachments.find(match);
		if (live) return live;
		for (const list of this.parked.values()) {
			const found = list.find(match);
			if (found) return found;
		}
		return undefined;
	}

	/** Apply a partial update to the attachment with this key. */
	private patchAttachment(key: string, patch: Partial<Attachment>): void {
		this.rewriteLists(key, (list) =>
			list.map((a) => ('key' in a && a.key === key ? ({ ...a, ...patch } as Attachment) : a))
		);
	}

	/** Update the upload state of the attachment with this key, if it has one. */
	private patchUploadState(key: string, next: (state: UploadState) => UploadState): void {
		this.rewriteLists(key, (list) =>
			list.map((a) =>
				'key' in a &&
				a.key === key &&
				(a.type === 'file' || a.type === 'screenshot') &&
				a.uploadState
					? { ...a, uploadState: next(a.uploadState) }
					: a
			)
		);
	}

	/** Remove an attachment by key and release everything held for it. */
	private discardAttachment(key: string): void {
		const attachment = this.findAttachment(key);
		if (attachment) {
			this.releaseUpload(attachment);
			this.revokePreview(attachment);
		}
		this.rewriteLists(key, (list) => list.filter((a) => !('key' in a) || a.key !== key));
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
		await this.runUpload(key, {
			blob,
			filename,
			dimensions,
			accessKey: this.uploadConfig.getAccessKey?.()
		});
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
