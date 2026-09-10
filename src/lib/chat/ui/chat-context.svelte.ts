/**
 * Chat UI Context
 *
 * Provides context for chat UI components to access shared state and configuration.
 * Uses Svelte's native context API with a class-based approach for type safety.
 */

import { getContext, setContext, untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { ConvexClient } from 'convex/browser';
import type { ChatSessionPort } from '../core/chat-session-port.js';
import type { Attachment, DisplayMessage, MessageRole } from '../core/types.js';
import { getChatSessionEpoch, isChatSessionCurrent } from '../core/chat-persisted-state.js';
import { FadeOnLoad } from '$lib/utils/fade-on-load.svelte.ts';
import type { AttachmentPreprocess } from './attachment-transfer.js';
import { ComposerAttachmentCoordinator } from './composer-attachment-coordinator.svelte.ts';
import type {
	ActiveUploadsRegistry,
	ComposerAttachmentSendSnapshot,
	UploadConfig
} from './composer-attachment-coordinator.svelte.ts';

export type {
	ActiveUploadsRegistry,
	UploadConfig
} from './composer-attachment-coordinator.svelte.ts';

type ThreadOriginBinder = (threadId: string, epoch: number, generation: number) => void;

export type ChatInputProjectionReason = 'user-edit' | 'send-clear' | 'send-restore';

export type ChatInputProjection = {
	value: string;
	reason: ChatInputProjectionReason;
	sessionEpoch: number;
	origin: ChatConversationOrigin;
	inputRevision: number;
};

export type ChatUIContextOptions = {
	bindThreadOrigin?: (binder: ThreadOriginBinder | undefined) => void;
	forgetSession?: () => void;
	projectInput?: (projection: ChatInputProjection) => void;
};

/**
 * Message alignment - controls which side messages appear on
 */
export type ChatAlignment = 'left' | 'right';

export type ChatConversationOrigin = {
	generation: number;
	threadId: string | null;
};

export type ChatSendSnapshot = {
	sessionEpoch: number;
	origin: ChatConversationOrigin;
	inputValue: string;
	inputRevision: number;
	inputClearedRevision?: number;
	attachments: ComposerAttachmentSendSnapshot;
};

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
	private inputRevision = 0;
	private conversationOrigin: ChatConversationOrigin;
	private disposed = false;
	private readonly options: ChatUIContextOptions;

	/** Attachment collection and lifecycle owner behind this UI facade. */
	private readonly attachmentCoordinator: ComposerAttachmentCoordinator;

	/** The one composer mounted inside this ChatRoot. */
	private composerFocus?: () => void;

	/** Tracks if we've ever displayed messages in this session */
	private _hasEverDisplayedMessages = false;

	constructor(
		core: ChatSessionPort,
		client: ConvexClient,
		uploadConfig?: UploadConfig,
		userAlignment: ChatAlignment = 'right',
		activeUploads: ActiveUploadsRegistry | null = null,
		options: ChatUIContextOptions = {}
	) {
		this.core = core;
		this.client = client;
		this.uploadConfig = uploadConfig;
		this.userAlignment = userAlignment;
		this.options = options;
		this.conversationOrigin = {
			generation: untrack(() => core.threadGeneration),
			threadId: untrack(() => core.threadId)
		};
		options.bindThreadOrigin?.((threadId, epoch, generation) => {
			if (!isChatSessionCurrent(epoch)) return;
			const origin = this.syncConversationOrigin();
			if (origin.generation === generation && origin.threadId === null) origin.threadId = threadId;
		});
		this.attachmentCoordinator = new ComposerAttachmentCoordinator({
			getThreadId: () => core.threadId,
			client,
			uploadConfig,
			activeUploads,
			onForgetPersistedState: () => {
				options.forgetSession?.();
				this.conversationOrigin = {
					generation: untrack(() => core.threadGeneration),
					threadId: untrack(() => core.threadId)
				};
				this.inputValue = '';
				this.inputRevision++;
			}
		});
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
		this.attachmentCoordinator.forgetPersistedState();
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
		this.syncConversationOrigin();
		// The attachment coordinator owns thread identity and preserves the
		// historical park/adopt transitions. UI animation resets only when leaving
		// a real thread, never when a new conversation first receives its id.
		if (this.attachmentCoordinator.syncThread()) {
			this.messagesFade.reset();
			this._hasEverDisplayedMessages = false;
		}
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
		if (!this.applyInputValue(value)) return;
		this.emitInputProjection('user-edit', getChatSessionEpoch(), this.syncConversationOrigin());
	}

	/** Apply a same-session peer projection without rebroadcasting it. */
	projectInputValue(value: string): void {
		this.applyInputValue(value);
	}

	private applyInputValue(value: string): boolean {
		if (this.disposed || this.inputValue === value) return false;
		this.inputValue = value;
		this.inputRevision++;
		return true;
	}

	private emitInputProjection(
		reason: ChatInputProjectionReason,
		sessionEpoch: number,
		origin: ChatConversationOrigin,
		inputRevision = this.inputRevision,
		value = this.inputValue
	): void {
		this.options.projectInput?.({
			value,
			reason,
			sessionEpoch,
			origin,
			inputRevision
		});
	}

	/**
	 * Clear input
	 */
	clearInput(): void {
		this.setInputValue('');
	}

	captureSendSnapshot(): ChatSendSnapshot {
		return {
			sessionEpoch: getChatSessionEpoch(),
			origin: this.syncConversationOrigin(),
			inputValue: this.inputValue,
			inputRevision: this.inputRevision,
			attachments: this.attachmentCoordinator.captureSendAttachments()
		};
	}

	private syncConversationOrigin(): ChatConversationOrigin {
		const generation = untrack(() => this.core.threadGeneration);
		const threadId = untrack(() => this.core.threadId);
		if (this.conversationOrigin.generation !== generation) {
			this.conversationOrigin = { generation, threadId };
		} else if (this.conversationOrigin.threadId !== threadId) {
			const assignedCurrentConversation =
				this.conversationOrigin.threadId === null &&
				threadId !== null &&
				untrack(() => this.core.isNewConversation);
			if (assignedCurrentConversation) this.conversationOrigin.threadId = threadId;
			else this.conversationOrigin = { generation, threadId };
		}
		return this.conversationOrigin;
	}

	clearInputForSend(snapshot: ChatSendSnapshot): void {
		if (
			!isChatSessionCurrent(snapshot.sessionEpoch) ||
			this.inputRevision !== snapshot.inputRevision ||
			this.inputValue !== snapshot.inputValue
		) {
			return;
		}
		if (!this.applyInputValue('')) return;
		snapshot.inputClearedRevision = this.inputRevision;
		this.emitInputProjection(
			'send-clear',
			snapshot.sessionEpoch,
			snapshot.origin,
			snapshot.inputRevision
		);
	}

	clearAttachmentsForSend(snapshot: ChatSendSnapshot): void {
		if (!isChatSessionCurrent(snapshot.sessionEpoch)) return;
		this.attachmentCoordinator.clearSendAttachments(snapshot.attachments);
	}

	isSendSnapshotCurrent(snapshot: ChatSendSnapshot): boolean {
		return (
			isChatSessionCurrent(snapshot.sessionEpoch) &&
			this.syncConversationOrigin() === snapshot.origin
		);
	}

	restoreSendSnapshot(snapshot: ChatSendSnapshot): void {
		if (!isChatSessionCurrent(snapshot.sessionEpoch)) return;
		const sameConversation = this.syncConversationOrigin() === snapshot.origin;
		if (
			sameConversation &&
			snapshot.inputClearedRevision !== undefined &&
			this.inputRevision === snapshot.inputClearedRevision &&
			this.inputValue === ''
		) {
			this.applyInputValue(snapshot.inputValue);
			this.emitInputProjection(
				'send-restore',
				snapshot.sessionEpoch,
				snapshot.origin,
				snapshot.inputRevision,
				snapshot.inputValue
			);
		}
		this.attachmentCoordinator.restoreSendAttachments(
			snapshot.attachments,
			snapshot.origin.threadId,
			sameConversation
		);
	}

	/** Rendered attachments for the current composer. */
	get attachments(): Attachment[] {
		return this.attachmentCoordinator.attachments;
	}

	/** Existing picker cap, now owned by the attachment coordinator. */
	get maxAttachments(): number {
		return this.attachmentCoordinator.maxAttachments;
	}

	/** Whether another picked attachment fits the cap. */
	get canAddAttachment(): boolean {
		return this.attachmentCoordinator.canAddAttachment;
	}

	/** Add already-built attachment snapshots. */
	addAttachments(newAttachments: Attachment[]): void {
		this.attachmentCoordinator.addAttachments(newAttachments);
	}

	/** Remove the attachment at an index. */
	removeAttachment(index: number): void {
		this.attachmentCoordinator.removeAttachment(index);
	}

	/** Remove every attachment from the live composer. */
	clearAttachments(): void {
		this.attachmentCoordinator.clearAttachments();
	}

	/** Release resources held by this mounted chat surface. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.options.bindThreadOrigin?.(undefined);
		this.attachmentCoordinator.dispose();
	}

	/** Check source and transformed identities for an existing file. */
	hasFile(name: string, size: number): boolean {
		return this.attachmentCoordinator.hasFile(name, size);
	}

	/** Upload a file through the attachment coordinator. */
	uploadFile(
		file: File | Blob,
		filename?: string,
		options?: { preprocess?: AttachmentPreprocess }
	): Promise<void> {
		return this.attachmentCoordinator.uploadFile(file, filename, options);
	}

	/** Retry the retained payload for a failed attachment. */
	retryUpload(index: number): void {
		this.attachmentCoordinator.retryUpload(index);
	}

	/** Upload a screenshot through the same composer attachment lifecycle. */
	uploadScreenshot(
		blob: Blob,
		filename: string,
		dimensions?: { width: number; height: number }
	): Promise<void> {
		return this.attachmentCoordinator.uploadScreenshot(blob, filename, dimensions);
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
		return this.attachmentCoordinator.hasUploadingFiles;
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
		return this.attachmentCoordinator.hasFailedUploads;
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
		return this.attachmentCoordinator.uploadedFileIds;
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
