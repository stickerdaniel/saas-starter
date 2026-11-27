/** Shared state and configuration of the chat UI components, set by ChatRoot. */

import { getContext, setContext, untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { ConvexClient } from 'convex/browser';
import type { ChatConversation, ChatSessionPort } from '../core/chat-session-port.svelte.ts';
import { MAX_MESSAGE_LENGTH } from '../core/types.js';
import type { Attachment, DisplayMessage, MessageRole } from '../core/types.js';
import { getChatSessionEpoch, isChatSessionCurrent } from '../core/chat-persisted-state.js';
import { FadeOnLoad } from '#lib/utils/fade-on-load.svelte.ts';
import type { UploadProfile } from '../../uploads/profiles.js';
import { ComposerAttachmentCoordinator } from './composer-attachment-coordinator.svelte.ts';
import type {
	ActiveUploadsRegistry,
	ComposerAttachmentSendSnapshot,
	ComposerUploadFileOptions,
	UploadConfig
} from './composer-attachment-coordinator.svelte.ts';
import {
	ChatComposer,
	type ComposerSendOutcome,
	type ComposerSendResources,
	type ComposerSendTarget
} from './chat-composer.svelte.ts';

export type {
	ActiveUploadsRegistry,
	CustomUploadConfig,
	DirectUploadConfig,
	UploadConfig
} from './composer-attachment-coordinator.svelte.ts';

export type ChatUIContextOptions = {
	forgetSession?: () => void;
	/**
	 * Holds this surface's text and settles its sends, and outlives this context,
	 * so a refusal that arrives after the view unmounted still finds its way back.
	 * Without one, the context gets a composer of its own that stores nothing.
	 */
	sendOwner?: ChatComposer;
};

export type ChatAlignment = 'left' | 'right';

export type ChatSendSnapshot = {
	sessionEpoch: number;
	conversation: ChatConversation;
	inputValue: string;
	attachments: ComposerAttachmentSendSnapshot;
};

/** Core state plus UI state such as the reasoning accordions. */
export class ChatUIContext implements ComposerSendTarget {
	readonly core: ChatSessionPort;

	readonly client: ConvexClient;

	/** Required by uploadFile */
	readonly uploadConfig?: UploadConfig;

	/** The assistant gets the opposite side */
	readonly userAlignment: ChatAlignment;

	reasoningOpenState = $state(new SvelteMap<string, boolean>());

	/** Messages auto-opened, for the auto-close logic */
	autoOpenedMessages = $state(new SvelteSet<string>());

	/** Reasoning blocks the user toggled, which auto-sync must not override */
	userToggledMessages = $state(new SvelteSet<string>());

	/** Set by ChatMessages */
	displayMessages = $state<DisplayMessage[]>([]);

	/** Whether the messages query has resolved, which prevents a suggestion chip flash */
	messagesReady = $state(false);

	readonly messagesFade = new FadeOnLoad<DisplayMessage[]>();

	private disposed = false;
	private readonly sendOwner: ChatComposer;
	private readonly detachFromSendOwner: () => void;
	/** Moves whenever the composer's pending sends do. */
	private pendingSendsVersion = $state(0);

	private readonly attachmentCoordinator: ComposerAttachmentCoordinator;

	/** The one composer mounted inside this ChatRoot. */
	private composerFocus?: () => void;

	/** Where that composer wants a refused screenshot reported. */
	private composerRefusal?: ComposerUploadFileOptions['onPreprocessFailed'];

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
		this.sendOwner = options.sendOwner ?? new ChatComposer();
		this.attachmentCoordinator = new ComposerAttachmentCoordinator({
			getThreadId: () => core.threadId,
			uploadConfig,
			activeUploads,
			onForgetPersistedState: () => {
				options.forgetSession?.();
				this.sendOwner.forgetPersistedState();
			},
			pendingSendAttachments: () => this.pendingSendAttachments
		});
		this.detachFromSendOwner = this.sendOwner.attachTarget(this);
		this.activate();
	}

	/** Show the text of the conversation the session shows now. ChatRoot calls it when that changes. */
	activate(): void {
		this.sendOwner.activate(this);
	}

	/**
	 * Lets go of every composer this context holds, because their session ended.
	 *
	 * Emptying storage alone is not enough: this context keeps its own copy and
	 * would write it back on its next save. The support widget belongs to the
	 * shell and stays mounted on the page the user lands on after signing out, so
	 * that write back would happen.
	 */
	forgetPersistedState(): void {
		this.attachmentCoordinator.forgetPersistedState();
	}

	/** User messages use userAlignment, every other role the opposite side. */
	getAlignment(role: MessageRole): ChatAlignment {
		if (role === 'user') return this.userAlignment;
		return this.userAlignment === 'right' ? 'left' : 'right';
	}

	isReasoningOpen(messageId: string): boolean {
		return this.reasoningOpenState.get(messageId) ?? false;
	}

	setReasoningOpen(messageId: string, isOpen: boolean): void {
		this.reasoningOpenState.set(messageId, isOpen);
	}

	toggleReasoning(messageId: string): void {
		const current = this.reasoningOpenState.get(messageId) ?? false;
		this.reasoningOpenState.set(messageId, !current);
	}

	wasAutoOpened(messageId: string): boolean {
		return this.autoOpenedMessages.has(messageId);
	}

	markAutoOpened(messageId: string): void {
		this.autoOpenedMessages.add(messageId);
	}

	/** Called after the auto-close */
	clearAutoOpened(messageId: string): void {
		this.autoOpenedMessages.delete(messageId);
	}

	getAutoOpenedKeys(): Iterable<string> {
		return this.autoOpenedMessages.keys();
	}

	markUserToggled(messageId: string): void {
		this.userToggledMessages.add(messageId);
	}

	wasUserToggled(messageId: string): boolean {
		return this.userToggledMessages.has(messageId);
	}

	clearUserToggled(messageId: string): void {
		this.userToggledMessages.delete(messageId);
	}

	getUserToggledKeys(): Iterable<string> {
		return this.userToggledMessages.keys();
	}

	setDisplayMessages(messages: DisplayMessage[]): void {
		// The attachment coordinator owns thread identity and its park/adopt
		// transitions. The UI animation resets only when leaving a real thread, never
		// when a new conversation first receives its id.
		if (this.attachmentCoordinator.syncThread()) {
			this.messagesFade.reset();
			this._hasEverDisplayedMessages = false;
		}
		this.displayMessages = messages;

		// Animate only the first display of messages
		if (messages.length > 0 && !this._hasEverDisplayedMessages) {
			this._hasEverDisplayedMessages = true;

			// Only when the first messages are real, not optimistic
			if (!this.messagesFade.hasLoadedOnce) {
				const hasRealMessages = messages.some((m) => !m.metadata?.optimistic);
				if (hasRealMessages) {
					this.messagesFade.markLoaded();
				}
			}
		}
	}

	/**
	 * Shows the existing thread the conversation moved to with that thread's own
	 * stored attachments, dropping the ones held for the conversation it left. For
	 * surfaces that never carry files from one conversation into another. Call it
	 * before the messages of the new thread are displayed.
	 */
	enterSelectedThread(): void {
		if (this.attachmentCoordinator.enterSelectedThread()) {
			this.messagesFade.reset();
			this._hasEverDisplayedMessages = false;
		}
	}

	/** True once the query has resolved */
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

	/** Report screenshots refused before upload through the mounted composer. */
	registerAttachmentRefusal(
		handler: NonNullable<ComposerUploadFileOptions['onPreprocessFailed']>
	): void {
		this.composerRefusal = handler;
	}

	unregisterAttachmentRefusal(
		handler: NonNullable<ComposerUploadFileOptions['onPreprocessFailed']>
	): void {
		if (this.composerRefusal === handler) this.composerRefusal = undefined;
	}

	/** The text of the conversation this context shows, held by the composer. A disposed context shows none. */
	get inputValue(): string {
		return this.disposed ? '' : this.sendOwner.textOf(this.core.conversation);
	}

	setInputValue(value: string): void {
		if (this.disposed) return;
		this.sendOwner.edit(this.conversation, value);
	}

	clearInput(): void {
		this.setInputValue('');
	}

	captureSendSnapshot(): ChatSendSnapshot {
		return {
			sessionEpoch: getChatSessionEpoch(),
			conversation: this.conversation,
			inputValue: untrack(() => this.inputValue),
			attachments: this.attachmentCoordinator.captureSendAttachments()
		};
	}

	private get conversation(): ChatConversation {
		return untrack(() => this.core.conversation);
	}

	clearInputForSend(snapshot: ChatSendSnapshot): void {
		if (this.disposed) return;
		this.sendOwner.clearSent(snapshot);
	}

	clearAttachmentsForSend(snapshot: ChatSendSnapshot): void {
		if (!isChatSessionCurrent(snapshot.sessionEpoch)) return;
		this.attachmentCoordinator.clearSendAttachments(snapshot.attachments);
	}

	isSendSnapshotCurrent(snapshot: ChatSendSnapshot): boolean {
		return (
			isChatSessionCurrent(snapshot.sessionEpoch) && this.conversation === snapshot.conversation
		);
	}

	/** Hand a cleared send to the surface's composer; call the result with its outcome. */
	beginSend(snapshot: ChatSendSnapshot): (outcome: ComposerSendOutcome) => void {
		const sendId = this.sendOwner.begin(this, snapshot);
		return (outcome) => this.sendOwner.settle(sendId, outcome);
	}

	restoreAttachments(attachments: Attachment[]): void {
		if (this.disposed) return;
		this.attachmentCoordinator.restoreSendAttachments({ attachments });
	}

	sendResources(): ComposerSendResources {
		return this.attachmentCoordinator.sendResources();
	}

	pendingSendsChanged(): void {
		this.pendingSendsVersion = untrack(() => this.pendingSendsVersion) + 1;
	}

	/** Files this conversation's unsettled sends hold, which a refusal would put back here. */
	private get pendingSendAttachments(): number {
		// The composer counts its sends untracked, so this read is what re-runs a
		// dependent when a send settles.
		void this.pendingSendsVersion;
		return this.sendOwner.pendingAttachmentCount(this);
	}

	/** Rendered attachments for the current composer. */
	get attachments(): Attachment[] {
		return this.attachmentCoordinator.attachments;
	}

	/** The upload policy every attachment entry point of this composer reads. */
	get uploadProfile(): UploadProfile {
		return this.attachmentCoordinator.profile;
	}

	/** The picker cap, owned by the attachment coordinator. */
	get maxAttachments(): number {
		return this.attachmentCoordinator.maxAttachments;
	}

	/** Whether another file fits the cap, counting the files of pending sends. */
	get canAddAttachment(): boolean {
		return this.attachmentCoordinator.canAddAttachment;
	}

	addAttachments(newAttachments: Attachment[]): void {
		this.attachmentCoordinator.addAttachments(newAttachments);
	}

	removeAttachment(index: number): void {
		this.attachmentCoordinator.removeAttachment(index);
	}

	clearAttachments(): void {
		this.attachmentCoordinator.clearAttachments();
	}

	/** Release resources held by this mounted chat surface. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.detachFromSendOwner();
		this.attachmentCoordinator.dispose();
	}

	/** Check source and transformed identities for an existing file. */
	hasFile(name: string, size: number): boolean {
		return this.attachmentCoordinator.hasFile(name, size);
	}

	uploadFile(
		file: File | Blob,
		filename?: string,
		options?: ComposerUploadFileOptions
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
		return this.attachmentCoordinator.uploadScreenshot(blob, filename, dimensions, {
			onPreprocessFailed: this.composerRefusal
		});
	}

	/** Resets state when the chat view slides out, e.g. back to the overview. */
	resetForNavigation(): void {
		this.messagesFade.reset();
		this._hasEverDisplayedMessages = false;
		this.displayMessages = [];
	}

	get lastMessage(): DisplayMessage | undefined {
		return this.displayMessages.at(-1);
	}

	get lastMessageIsUser(): boolean {
		return this.lastMessage?.role === 'user';
	}

	get isEmpty(): boolean {
		return this.displayMessages.length === 0;
	}

	get hasUploadingFiles(): boolean {
		return this.attachmentCoordinator.hasUploadingFiles;
	}

	/**
	 * Blocks sending: only successful uploads reach the backend while the whole
	 * attachment list renders optimistically, so a send would show a file that was
	 * never stored. The inline error offers retry and discard.
	 */
	get hasFailedUploads(): boolean {
		return this.attachmentCoordinator.hasFailedUploads;
	}

	/** Whether the text is longer than one message may be, as after a refused send merged back. */
	get exceedsMessageLength(): boolean {
		return this.inputValue.length > MAX_MESSAGE_LENGTH;
	}

	/** Whether the composer holds more files than one message may carry. */
	get exceedsAttachmentLimit(): boolean {
		return this.attachments.length > this.maxAttachments;
	}

	/**
	 * Whether what the composer holds passes the upload and size gates, whether
	 * or not it carries any text.
	 */
	get sendGatesOpen(): boolean {
		return (
			!this.hasUploadingFiles &&
			!this.hasFailedUploads &&
			!this.exceedsMessageLength &&
			!this.exceedsAttachmentLimit
		);
	}

	get canSend(): boolean {
		return this.sendGatesOpen && !!this.inputValue.trim();
	}

	/** Reads displayMessages, which always mirrors the query. */
	get isStreaming(): boolean {
		return this.displayMessages.some(
			(m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
		);
	}

	/** Sending, awaiting a stream, or streaming. The one input-blocking signal. */
	get isProcessing(): boolean {
		return this.core.isSending || this.core.isAwaitingStream || this.isStreaming;
	}

	get uploadedFileIds(): string[] {
		return this.attachmentCoordinator.uploadedFileIds;
	}
}

const CHAT_UI_KEY = Symbol('chat-ui');

export function setChatUIContext(context: ChatUIContext): void {
	setContext(CHAT_UI_KEY, context);
}

/** @throws Error if used outside of ChatRoot */
export function getChatUIContext(): ChatUIContext {
	const context = getContext<ChatUIContext>(CHAT_UI_KEY);

	if (!context) {
		throw new Error('Chat UI components must be used within ChatRoot');
	}

	return context;
}

export function tryGetChatUIContext(): ChatUIContext | undefined {
	return getContext<ChatUIContext>(CHAT_UI_KEY);
}
