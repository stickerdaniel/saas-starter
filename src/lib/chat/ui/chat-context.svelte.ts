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
import { attachmentFileIdentity } from './attachment-transfer.js';
import {
	uploadProfileOf,
	type ActiveUploadsRegistry,
	type ComposerAttachmentSendSnapshot,
	type ComposerUploadFileOptions,
	type UploadConfig
} from './composer-attachment-coordinator.svelte.ts';
import type { ChatComposer, ComposerSendOutcome, ComposerView } from './chat-composer.svelte.ts';

export type {
	ActiveUploadsRegistry,
	CustomUploadConfig,
	DirectUploadConfig,
	UploadConfig
} from './composer-attachment-coordinator.svelte.ts';

export type ChatAlignment = 'left' | 'right';

export type ChatSendSnapshot = {
	sessionEpoch: number;
	conversation: ChatConversation;
	inputValue: string;
	attachments: ComposerAttachmentSendSnapshot;
};

/** Core state plus UI state such as the reasoning accordions. */
export class ChatUIContext implements ComposerView {
	readonly core: ChatSessionPort;

	readonly client: ConvexClient;

	/** Required by uploadFile */
	readonly uploadConfig?: UploadConfig;

	/** The assistant gets the opposite side */
	readonly userAlignment: ChatAlignment;

	/** Where the uploads this view starts report that they are running. */
	readonly activeUploads: ActiveUploadsRegistry | null;

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
	private readonly composer: ChatComposer;
	/** The composer session this view was made for. */
	private readonly session: number;
	private readonly detachFromComposer: () => void;

	/** The one composer mounted inside this ChatRoot. */
	private composerFocus?: () => void;

	/** Where that composer wants a refused screenshot reported. */
	private composerRefusal?: ComposerUploadFileOptions['onPreprocessFailed'];

	private _hasEverDisplayedMessages = false;

	/**
	 * @param composer holds this surface's text, attachments and sends, and
	 * outlives this context, so a refusal that arrives after the view unmounted
	 * still finds its way back.
	 */
	constructor(
		core: ChatSessionPort,
		client: ConvexClient,
		composer: ChatComposer,
		uploadConfig?: UploadConfig,
		userAlignment: ChatAlignment = 'right',
		activeUploads: ActiveUploadsRegistry | null = null
	) {
		this.core = core;
		this.client = client;
		this.composer = composer;
		this.session = untrack(() => composer.session);
		this.uploadConfig = uploadConfig;
		this.userAlignment = userAlignment;
		this.activeUploads = activeUploads;
		this.detachFromComposer = composer.addView(this);
		this.activate();
	}

	/**
	 * Disposed, or made for a session that has ended. Such a view shows nothing
	 * and changes nothing, also before its surface remounts it.
	 */
	private get retired(): boolean {
		return this.disposed || this.sessionEnded;
	}

	/** Whether the session this view was made for has ended. Its sends belong to nobody. */
	private get sessionEnded(): boolean {
		return this.composer.session !== this.session;
	}

	/**
	 * Show the text and files of the conversation the session shows now. ChatRoot
	 * calls it when that changes. Leaving a real thread restarts the message fade.
	 */
	activate(): void {
		if (this.retired) return;
		if (this.composer.activate(this)) {
			this.messagesFade.reset();
			this._hasEverDisplayedMessages = false;
		}
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
	 * Drops the files of a conversation this surface left, stored ones included.
	 * For surfaces that never carry files from one conversation into another.
	 */
	discardAttachments(conversation: ChatConversation): void {
		if (this.retired) return;
		this.composer.discardAttachments(conversation);
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

	/** The text of the conversation this context shows, held by the composer. A retired context shows none. */
	get inputValue(): string {
		return this.retired ? '' : this.composer.textOf(this.core.conversation);
	}

	setInputValue(value: string): void {
		if (this.retired) return;
		this.composer.edit(this.conversation, value);
	}

	clearInput(): void {
		this.setInputValue('');
	}

	/** What a send would carry now. A context of an ended session carries nothing. */
	captureSendSnapshot(): ChatSendSnapshot {
		return {
			sessionEpoch: getChatSessionEpoch(),
			conversation: this.conversation,
			inputValue: untrack(() => this.inputValue),
			attachments: untrack(() => this.sessionEnded)
				? { attachments: [] }
				: this.composer.captureAttachments(this.conversation)
		};
	}

	private get conversation(): ChatConversation {
		return untrack(() => this.core.conversation);
	}

	clearInputForSend(snapshot: ChatSendSnapshot): void {
		if (this.retired) return;
		this.composer.clearSent(snapshot);
	}

	clearAttachmentsForSend(snapshot: ChatSendSnapshot): void {
		this.composer.clearSentAttachments(snapshot);
	}

	isSendSnapshotCurrent(snapshot: ChatSendSnapshot): boolean {
		return (
			!untrack(() => this.sessionEnded) &&
			isChatSessionCurrent(snapshot.sessionEpoch) &&
			this.conversation === snapshot.conversation
		);
	}

	/**
	 * Hand a cleared send to the surface's composer; call the result with its
	 * outcome. A context of an ended session hands over nothing, and its result
	 * does nothing.
	 */
	beginSend(snapshot: ChatSendSnapshot): (outcome: ComposerSendOutcome) => void {
		if (untrack(() => this.sessionEnded)) return () => {};
		const sendId = this.composer.begin(snapshot);
		return (outcome) => this.composer.settle(sendId, outcome);
	}

	/** Rendered attachments of the conversation this context shows. A retired context shows none. */
	get attachments(): Attachment[] {
		return this.retired ? [] : this.composer.attachmentsOf(this.core.conversation);
	}

	/** The upload policy every attachment entry point of this view reads. */
	get uploadProfile(): UploadProfile {
		return uploadProfileOf(this.uploadConfig);
	}

	/** The picker cap of this view. */
	get maxAttachments(): number {
		return this.uploadProfile.maxFiles;
	}

	/** Whether another file fits the cap, counting the files of pending sends. */
	get canAddAttachment(): boolean {
		return this.composer.canAddAttachment(this);
	}

	addAttachments(newAttachments: Attachment[]): void {
		if (this.retired) return;
		this.composer.addAttachments(this, newAttachments);
	}

	removeAttachment(index: number): void {
		if (this.retired) return;
		this.composer.removeAttachment(this.conversation, index);
	}

	clearAttachments(): void {
		if (this.retired) return;
		this.composer.clearAttachments(this.conversation);
	}

	/** Stop showing anything; the composer lets go of what no other view shows. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.detachFromComposer();
	}

	/** Check source and transformed identities for an existing file. */
	hasFile(name: string, size: number): boolean {
		const picked = `${name}:${size}`;
		return this.attachments.some((attachment) =>
			attachmentFileIdentity(attachment).includes(picked)
		);
	}

	uploadFile(
		file: File | Blob,
		filename?: string,
		options?: ComposerUploadFileOptions
	): Promise<void> {
		if (this.retired) return Promise.resolve();
		return this.composer.uploadFile(this, file, filename, options);
	}

	/** Retry the retained payload for a failed attachment. */
	retryUpload(index: number): void {
		if (this.retired) return;
		this.composer.retryUpload(this.conversation, index);
	}

	/** Upload a screenshot through the same composer attachment lifecycle. */
	uploadScreenshot(
		blob: Blob,
		filename: string,
		dimensions?: { width: number; height: number }
	): Promise<void> {
		if (this.retired) return Promise.resolve();
		return this.composer.uploadScreenshot(this, blob, filename, dimensions, {
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
		return this.attachments.some(
			(attachment) =>
				(attachment.type === 'file' || attachment.type === 'screenshot') &&
				attachment.uploadState?.status === 'uploading'
		);
	}

	/**
	 * Blocks sending: only successful uploads reach the backend while the whole
	 * attachment list renders optimistically, so a send would show a file that was
	 * never stored. The inline error offers retry and discard.
	 */
	get hasFailedUploads(): boolean {
		return this.attachments.some(
			(attachment) =>
				(attachment.type === 'file' || attachment.type === 'screenshot') &&
				attachment.uploadState?.status === 'error'
		);
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
		return this.attachments
			.filter(
				(attachment): attachment is Extract<Attachment, { type: 'file' | 'screenshot' }> =>
					(attachment.type === 'file' || attachment.type === 'screenshot') &&
					attachment.uploadState?.status === 'success'
			)
			.map((attachment) => attachment.uploadState!.fileId!)
			.filter(Boolean);
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
