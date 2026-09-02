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
import type { ChatSessionPort } from '../core/chat-session-port.js';
import type { DisplayMessage, Attachment, MessageRole } from '../core/types.js';
import { uploadFileWithProgress } from '../core/file-uploader.js';
import type {
	AttachmentsByThread,
	ChatAttachmentStore
} from '../core/chat-attachment-store.svelte.ts';
import { registerPersistedChatHolder } from '../core/chat-persisted-state.ts';
import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.ts';
import {
	AttachmentTransfer,
	attachmentFileIdentity,
	attachmentProgressRank,
	isAttachmentTransferAbort,
	isSameAttachmentFile,
	isStoredAttachment,
	revokeAttachmentPreview,
	type AttachmentPreprocess,
	type AttachmentTransferSnapshot
} from './attachment-transfer.js';

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
	readonly core: ChatSessionPort;

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

	/** Takes this context back out of the register of mounted composers. */
	private readonly unregister: () => void;

	/** One native lifecycle owner for each attachment that can still transfer. */
	private readonly transfers = new SvelteMap<string, AttachmentTransfer>();

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
	 * Wider than active transport, because an image
	 * spends a visible stretch in the WebP encoder first, with the tile already
	 * showing progress, and losing the page there loses the pick just the same.
	 * Also narrower where it matters: a discarded attachment leaves this set at
	 * once, even though the request it started may take a while to unwind.
	 */
	private readonly pendingUploads = new SvelteSet<string>();

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
		core: ChatSessionPort,
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
		this.unregister = registerPersistedChatHolder(this);
	}

	/**
	 * Let go of every composer this context is holding, because the session they
	 * belong to has ended.
	 *
	 * Emptying storage is not enough on its own: this context keeps its own
	 * copy and would write it back on its next save. The support widget makes
	 * that certain rather than unlikely, since it belongs to the shell and is
	 * still mounted on whatever page the user lands on after signing out.
	 */
	forgetPersistedState(): void {
		const abandoned = [...this.parked.keys()];
		for (const attachments of this.parked.values()) {
			for (const attachment of attachments) {
				this.releaseUpload(attachment);
				this.revokePreview(attachment);
			}
		}
		this.parked.clear();
		// A transfer still running belongs to an identity that is gone, so it is
		// stopped here for the same reason sign-out does not wait for one.
		this.clearAttachments();
		this.inputValue = '';
		// Named so they are struck from storage rather than merely dropped here.
		// The sweep empties the whole key anyway; doing it from this side too
		// means letting go stays complete on its own terms.
		this.persist(...abandoned);
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
				// The conversation with no id is this thread now, and what its
				// composer holds comes along in the live list. Its own leavings may
				// not stay behind under the empty key: sending would clear this
				// thread's entry and not that one, and the next load with no id
				// would offer back a file that has already gone out.
				//
				// Only its own. That key belongs to every conversation still waiting
				// for an id, so another tab may be sitting on one, and its files are
				// not this page's to strike.
				this.parked.delete('');
				this.adoptParked(currentThreadId);
				this.parked.set('', this.strangersUnderEmptyKey());
				this.persist('');
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
	 * Write down what the composers this call changed are holding, so a reload
	 * can hand them back.
	 *
	 * Called from each method that changes either list, naming the threads it
	 * changed. Only settled uploads reach storage, so the progress of a running
	 * one passes through here without producing a write.
	 *
	 * Nothing else goes into the save, not even the parked lists this page is
	 * holding: they were written when they were parked, and another tab on the
	 * same chat may have moved them on since. Sending this page's copy back
	 * would undo whatever that tab did, and revive what it had removed.
	 *
	 * What is left is two tabs both standing in one thread and both changing it,
	 * where the later save wins. The draft beside it settles that the same way.
	 * Walking into a thread is not that case: entering takes storage as the
	 * authority for everything it speaks for, so moving around cannot cost
	 * another tab its work.
	 */
	/**
	 * What is filed under the empty key that this composer did not put there.
	 *
	 * Every conversation still waiting for an id shares that key, so a page that
	 * has just been given one has to leave the rest alone. Told apart by the
	 * transfer that stored each one: anything this composer is carrying into its
	 * thread is its own, and everything else belongs to a conversation elsewhere,
	 * even where two of them uploaded the very same file.
	 */
	private strangersUnderEmptyKey(): Attachment[] {
		const stored = this.uploadConfig?.attachmentStore?.readThread(null) ?? [];
		// Lives and dies inside this call.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const mine = new Set(this.attachments.map((a) => ('key' in a ? a.key : undefined)));
		return stored.filter((a) => !('key' in a) || !mine.has(a.key));
	}

	private persist(...alsoChanged: Array<string | null>): void {
		const store = this.uploadConfig?.attachmentStore;
		if (!store || this.disposed) return;
		// Same empty key the parked lists use for a conversation with no id yet.
		const liveKey = untrack(() => this.core.threadId) ?? '';

		// Handed straight to the store, never rendered.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const snapshot: AttachmentsByThread = new Map();
		for (const threadId of alsoChanged) {
			const key = threadId ?? '';
			// An empty list where the thread has nothing any more, which is how a
			// composer that was emptied gets struck from storage rather than left.
			if (key !== liveKey) snapshot.set(key, this.parked.get(key) ?? []);
		}
		snapshot.set(liveKey, this.attachments);
		store.write(snapshot);
	}

	/**
	 * Revoke an attachment's blob preview URL (no-op for non-blob previews).
	 * Optimistic clones strip `preview` (see `sanitizeAttachmentsForClone`),
	 * so revoking when an attachment leaves the composer cannot break the
	 * optimistic message render, which falls back to the uploaded `url`.
	 */
	private revokePreview(attachment: Attachment): void {
		revokeAttachmentPreview(attachment);
	}

	/**
	 * Cancel an attachment's in-flight upload and drop everything held for it.
	 * Attachments handed in from outside may have no `key` and never started an
	 * upload, so a missing entry is normal rather than an error.
	 */
	private releaseUpload(attachment: Attachment): void {
		const key = 'key' in attachment ? attachment.key : undefined;
		if (!key) return;
		this.transfers.get(key)?.dispose();
		this.transfers.delete(key);
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
		const store = this.uploadConfig?.attachmentStore;
		const held = this.parked.get(key) ?? [];
		// What this page is holding for the thread it is entering, minus anything
		// storage speaks for. Another tab on the same chat may have added to that
		// thread, or taken something out of it, since this page last looked, and
		// on the way in storage is the one that knows. Where there is no storage
		// this page is the only one that knows, and keeps all of it.
		const carried: Attachment[] = [];
		for (const attachment of held) {
			if (store && isStoredAttachment(attachment)) {
				// Its copy off disk is the same file without the local preview, so
				// the tile falls back to the uploaded url. The preview this one is
				// holding has to go now: nothing else will ever see this object
				// again, and an image kept this way outlives the page.
				this.revokePreview(attachment);
				continue;
			}
			carried.push(attachment);
		}
		this.attachments = carried;
		this.parked.delete(key);
		// What it says now, which is not what this page took when it started. Read
		// on the way in for the same reason the draft beside it is, and merged
		// rather than taken whole, because a transfer still running exists only
		// here and storage has no way to know about it.
		const stored = store?.readThread(entering) ?? [];
		if (stored.length > 0) {
			this.parked.set(key, stored);
			this.adoptParked(entering);
		}
		this.persist(leaving);
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
				(live, index) => !supersededLive[index] && isSameAttachmentFile(candidate, live)
			);
			const rival = rivalIndex === -1 ? undefined : this.attachments[rivalIndex];
			if (!rival) {
				adopted.push(candidate);
				continue;
			}
			// Ties go to the parked copy, which has the head start on its transfer.
			if (attachmentProgressRank(candidate) >= attachmentProgressRank(rival)) {
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
		this.persist(threadId);
	}

	/**
	 * Release resources held by this context. Call on unmount of the owning
	 * component so blob preview URLs of unsent attachments do not leak until
	 * the document unloads.
	 */
	dispose(): void {
		this.unregister();
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
	 * Check if a file with the same name and size already exists
	 */
	hasFile(name: string, size: number): boolean {
		const picked = `${name}:${size}`;
		return this.attachments.some((a) => attachmentFileIdentity(a).includes(picked));
	}

	/** Build one lifecycle owner while this context remains the list coordinator. */
	private createTransfer(
		key: string,
		blob: File | Blob,
		filename: string,
		mimeType: string,
		accessKey?: string,
		dimensions?: { width: number; height: number },
		measureImageDimensions = true
	): AttachmentTransfer {
		const config = this.uploadConfig;
		if (!config) throw new Error('Upload config not provided to ChatUIContext');

		const transfer = new AttachmentTransfer({
			key,
			blob,
			filename,
			mimeType,
			dimensions,
			accessKey,
			measureImageDimensions,
			upload: (payload, onProgress, signal) =>
				uploadFileWithProgress(
					this.client,
					payload.blob,
					payload.filename,
					onProgress,
					config,
					payload.dimensions,
					payload.accessKey,
					signal
				),
			onSnapshot: (snapshot) => {
				// The transfer also rejects stale attempts internally. This owner
				// check keeps a disposed/replaced transfer from reaching the lists.
				if (this.transfers.get(key) !== transfer) return;
				// The synchronous placeholder already represents preprocessing. The
				// internal phase stays observable without introducing an extra list
				// rewrite or persistence pass before preprocessing completes.
				if (snapshot.phase === 'preprocessing') return;
				this.applyTransferSnapshot(snapshot);
				if (snapshot.phase === 'success') this.transfers.delete(key);
			},
			onActivityChange: (active) => {
				if (active) this.markPending(key);
				else this.settlePending(key);
			},
			onAttemptError: (error) => console.error('[ChatUIContext] Upload failed:', error)
		});
		this.transfers.set(key, transfer);
		return transfer;
	}

	/** Adapt an internal transfer snapshot to the existing rendered shape. */
	private applyTransferSnapshot(snapshot: AttachmentTransferSnapshot): void {
		const uploadState =
			snapshot.phase === 'success'
				? { status: 'success' as const, progress: 100, fileId: snapshot.fileId }
				: snapshot.phase === 'error'
					? { status: 'error' as const, progress: 0, error: snapshot.error }
					: { status: 'uploading' as const, progress: snapshot.progress };
		const patch: Partial<Attachment> = {
			name: snapshot.name,
			mimeType: snapshot.mimeType,
			size: snapshot.size,
			uploadState
		};
		if (snapshot.dimensions) {
			patch.width = snapshot.dimensions.width;
			patch.height = snapshot.dimensions.height;
		}
		if (snapshot.phase === 'success') patch.url = snapshot.url;
		this.patchAttachment(snapshot.key, patch);
	}

	/**
	 * Upload a file and add it as an attachment.
	 * The placeholder remains synchronous; AttachmentTransfer owns everything
	 * from preprocessing through retryable transport completion.
	 */
	async uploadFile(
		file: File | Blob,
		filename?: string,
		options?: { preprocess?: AttachmentPreprocess }
	): Promise<void> {
		if (!this.uploadConfig) {
			throw new Error('Upload config not provided to ChatUIContext');
		}

		const initialName = filename ?? (file instanceof File ? file.name : 'file');
		const key = crypto.randomUUID();

		// Synchronously insert the placeholder before preprocessing so batching,
		// deduplication, attachment caps, and sending see the pending file at once.
		const isImageType = file.type.startsWith('image/');
		const placeholder: Attachment = {
			type: 'file',
			key,
			name: initialName,
			size: file.size,
			mimeType: file.type,
			preview: isImageType ? URL.createObjectURL(file) : undefined,
			// The rendered text preview, not the transfer, owns this source File.
			file: !isImageType && file instanceof File ? file : undefined,
			uploadState: { status: 'uploading', progress: 0 },
			sourceName: initialName,
			sourceSize: file.size
		};
		this.attachments = [...this.attachments, placeholder];

		// Capture ownership before any async preprocessing can outlive this thread.
		const transfer = this.createTransfer(
			key,
			file,
			initialName,
			file.type,
			this.uploadConfig.getAccessKey?.()
		);
		const result = await transfer.start(options?.preprocess);

		if (result.status !== 'preprocess-failed') return;
		// Preprocessing cannot necessarily stop when the user removes the chip.
		// Its late rejection is therefore ignored when no attachment remains.
		const stillPresent = this.findAttachment(key) !== undefined;
		this.discardAttachment(key);
		if (isAttachmentTransferAbort(result.error) || !stillPresent) return;
		const translate = this.uploadConfig.translate;
		toast.error(
			translate?.('chat.error.upload_failed', { filename: initialName }) ??
				`Failed to upload "${initialName}"`
		);
	}

	/** Retry with the transfer's exact retained post-preprocessing payload. */
	retryUpload(index: number): void {
		const attachment = this.attachments[index];
		if (!attachment || !('key' in attachment) || !attachment.key) return;
		void this.transfers.get(attachment.key)?.retry();
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
		const rewritten: string[] = [];
		for (const [threadId, list] of this.parked) {
			if (!holds(list)) continue;
			rewritten.push(threadId);
			const next = rewrite(list);
			if (next.length > 0) this.parked.set(threadId, next);
			else this.parked.delete(threadId);
		}
		this.persist(...rewritten);
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

		// Screenshots already carry their final blob and any known dimensions, so
		// their transfer starts directly and retains that exact payload for retry.
		const transfer = this.createTransfer(
			key,
			blob,
			filename,
			blob.type,
			this.uploadConfig.getAccessKey?.(),
			dimensions,
			false
		);
		await transfer.start();
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
