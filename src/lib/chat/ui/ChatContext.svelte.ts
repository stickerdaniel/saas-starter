/**
 * Chat UI Context
 *
 * Provides context for chat UI components to access shared state and configuration.
 * Uses Svelte's native context API with a class-based approach for type safety.
 */

import { getContext, setContext } from 'svelte';
import type { ConvexClient } from 'convex/browser';
import type { ChatCore } from '../core/ChatCore.svelte.js';
import type { DisplayMessage, Attachment } from '../core/types.js';

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

	/** UI state: which reasoning accordions are open */
	reasoningOpenState = $state<Map<string, boolean>>(new Map());

	/** Processed messages with display fields (set by ChatMessages) */
	displayMessages = $state<DisplayMessage[]>([]);

	/** Current input value */
	inputValue = $state('');

	/** Attachments for current message */
	attachments = $state<Attachment[]>([]);

	constructor(core: ChatCore, client: ConvexClient) {
		this.core = core;
		this.client = client;
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
		this.displayMessages = messages;
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
	 * Check if any upload has failed
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
