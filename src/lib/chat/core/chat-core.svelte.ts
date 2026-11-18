/** Headless chat state without UI dependencies. */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import type {
	SendMessageOptions,
	SendMessageResult,
	ChatConfig,
	CreateThreadOptions,
	ChatMessagesQuery
} from './types.js';
import { DEFAULT_CHAT_CONFIG } from './types.js';
import { StreamCacheManager } from './stream-cache.js';
import { createOptimisticUpdate, type ListMessagesArgs } from './optimistic.js';
import { getChatSessionEpoch, isChatSessionCurrent } from './chat-persisted-state.js';
import type { AwaitedTurn, ChatSessionPort } from './chat-session-port.js';
import { ChatCommandError, type ChatCommandErrorCode } from './chat-command-error.js';

export type ChatCoreErrorCode = ChatCommandErrorCode | 'send_failed' | 'create_thread_failed';
type CreateThreadArgs = CreateThreadOptions & Record<string, unknown>;

export interface CreateThreadResult {
	threadId: string;
	notificationEmail?: string | null;
	[key: string]: unknown;
}

export interface ChatCoreAPI {
	sendMessage: FunctionReference<
		'mutation',
		'public',
		{
			threadId: string;
			prompt: string;
			userId?: string;
			fileIds?: string[];
		},
		SendMessageResult
	>;
	/** Returns a CreateThreadResult */
	createThread?: FunctionReference<'mutation', 'public', CreateThreadArgs, CreateThreadResult>;
	/** Required for optimistic updates */
	listMessages?: ChatMessagesQuery;
}

export interface ChatCoreOptions {
	threadId?: string | null;
	/** Bind commands for headless sends; omit when the surface owns its commands. */
	api?: ChatCoreAPI;
	config?: ChatConfig;
}

/** Stream processing lives in StreamCacheManager. */
export class ChatCore implements ChatSessionPort {
	threadId = $state<string | null>(null);
	/** True while a new conversation starts, so suggestions show at once */
	isNewConversation = $state(false);
	/** Bumps on every new thread session. A {#key} on it replays the chip
	 *  entrance animations. */
	threadGeneration = $state(0);

	isLoading = $state(false);
	isSending = $state(false);

	error = $state<ChatCoreErrorCode | null>(null);

	hasMore = $state(false);
	continueCursor = $state<string | null>(null);

	shouldOpenWidget = $state(false);

	/**
	 * The response the last send waits on, sticky until the UI sees it. A send
	 * waits as `unaccepted` until the backend returns the prompt's order, then
	 * as `accepted` at that order.
	 */
	awaitedTurn = $state<AwaitedTurn | null>(null);

	readonly streamCache = new StreamCacheManager();

	private readonly api?: ChatCoreAPI;
	private readonly config: Required<ChatConfig>;
	private sendRevision = 0;
	private provisionalThreadBinding: { threadId: string; sendRevision: number } | null = null;
	private threadOriginBinder?: (threadId: string, epoch: number, generation: number) => void;

	constructor(options: ChatCoreOptions) {
		this.threadId = options.threadId ?? null;
		this.isNewConversation = this.threadId === null;
		this.api = options.api;
		this.config = { ...DEFAULT_CHAT_CONFIG, ...options.config };
	}

	get hasThread(): boolean {
		return this.threadId !== null;
	}

	get isAwaitingStream(): boolean {
		return this.awaitedTurn !== null;
	}

	setThreadOriginBinder(
		binder: ((threadId: string, epoch: number, generation: number) => void) | undefined
	): void {
		this.threadOriginBinder = binder;
	}

	setThread(threadId: string | null): void {
		const bindsActiveProvisionalThread =
			this.threadId === null &&
			threadId !== null &&
			this.provisionalThreadBinding?.threadId === threadId &&
			this.provisionalThreadBinding.sendRevision === this.sendRevision;
		if (threadId !== this.threadId && !bindsActiveProvisionalThread) {
			this.sendRevision++;
			this.provisionalThreadBinding = null;
			this.isSending = false;
			this.awaitedTurn = null;
		}
		this.threadId = threadId;
		this.isNewConversation = threadId === null;
		this.hasMore = false;
		this.continueCursor = null;
		this.error = null;
		this.streamCache.clear();
	}

	setLoading(loading: boolean): void {
		this.isLoading = loading;
	}

	setSending(sending: boolean): void {
		this.isSending = sending;
	}

	setError(error: ChatCoreErrorCode | null): void {
		this.error = error;
	}

	clearError(): void {
		this.error = null;
	}

	/** Used when a message is sent from the chatbar */
	requestWidgetOpen(): void {
		this.shouldOpenWidget = true;
	}

	clearWidgetOpenRequest(): void {
		this.shouldOpenWidget = false;
	}

	/** `true` starts an `unaccepted` wait, `false` settles the awaited turn. */
	setAwaitingStream(awaiting: boolean): void {
		this.awaitedTurn = awaiting ? { kind: 'unaccepted' } : null;
	}

	private isSendOperationCurrent(sessionEpoch: number, sendRevision: number): boolean {
		return isChatSessionCurrent(sessionEpoch) && this.sendRevision === sendRevision;
	}

	/**
	 * Sends a message. Creates the thread first when none exists and the
	 * createThread API is configured, and applies an optimistic update that Convex
	 * rolls back on failure.
	 */
	async sendMessage(
		client: ConvexClient,
		prompt: string,
		options?: SendMessageOptions
	): Promise<SendMessageResult & { threadCreated?: CreateThreadResult }> {
		const trimmedPrompt = prompt.trim();

		// Expected local refusals are machine-readable; callers own localized copy.
		if (!trimmedPrompt) {
			this.setError('empty_input');
			throw new ChatCommandError('empty_input');
		}
		if (this.isSending) {
			this.setError('send_in_progress');
			throw new ChatCommandError('send_in_progress');
		}

		const api = this.api;
		if (!api) {
			throw new Error('Chat commands are not configured for this session');
		}

		const sessionEpoch = getChatSessionEpoch();
		const sendRevision = ++this.sendRevision;
		this.clearError();
		this.setSending(true);
		this.setAwaitingStream(true);

		let threadCreated: CreateThreadResult | undefined;
		let failureCode: ChatCoreErrorCode = 'send_failed';

		try {
			// Lazy thread creation
			let threadId = this.threadId;
			if (!threadId) {
				failureCode = 'create_thread_failed';
				if (!api.createThread) {
					throw new Error('Cannot send message: no thread and createThread not configured');
				}

				const result = await client.mutation(api.createThread, {
					...options?.createThreadOptions
				});
				if (!this.isSendOperationCurrent(sessionEpoch, sendRevision)) {
					throw new Error('Chat session ended');
				}

				threadId = result.threadId;
				threadCreated = result;
				this.provisionalThreadBinding = { threadId, sendRevision };
				this.threadOriginBinder?.(threadId, sessionEpoch, this.threadGeneration);

				// Assigned directly: setThread would clear streamCache, error, and the
				// pagination cursors
				this.threadId = threadId;
				this.provisionalThreadBinding = null;
				this.isNewConversation = false;
				failureCode = 'send_failed';
			}

			const mutationOptions = api.listMessages
				? {
						optimisticUpdate: createOptimisticUpdate(
							api.listMessages,
							{
								threadId,
								paginationOpts: { numItems: this.config.pageSize, cursor: null },
								streamArgs: { kind: 'list' as const, startOrder: 0 }
							} satisfies ListMessagesArgs,
							'user',
							trimmedPrompt,
							{ attachments: options?.attachments }
						)
					}
				: undefined;

			const result = await client.mutation(
				api.sendMessage,
				{
					threadId,
					prompt: trimmedPrompt,
					userId: options?.userId,
					fileIds: options?.fileIds
				},
				mutationOptions
			);
			if (!this.isSendOperationCurrent(sessionEpoch, sendRevision)) {
				return { ...result, threadCreated };
			}
			// The reply, its stream or the notice replacing it lands at the saved
			// prompt's order; a wait already settled stays settled.
			if (this.awaitedTurn !== null) {
				this.awaitedTurn = { kind: 'accepted', order: result.order };
			}

			if (options?.openWidgetAfter) {
				this.requestWidgetOpen();
			}

			return { ...result, threadCreated };
		} catch (error) {
			if (this.isSendOperationCurrent(sessionEpoch, sendRevision)) {
				console.error('[ChatCore.sendMessage] Failed');
				this.setError(failureCode);
				this.setAwaitingStream(false);
			}
			// Convex rolls the optimistic update back
			throw error;
		} finally {
			if (this.isSendOperationCurrent(sessionEpoch, sendRevision)) {
				this.setSending(false);
			}
		}
	}

	async createThread(
		client: ConvexClient,
		options?: CreateThreadOptions
	): Promise<CreateThreadResult> {
		if (!this.api?.createThread) {
			throw new Error('createThread API not configured');
		}

		this.setLoading(true);
		try {
			const result = await client.mutation(this.api.createThread, { ...options });
			this.setThread(result.threadId);
			return result;
		} catch (error) {
			console.error('[ChatCore.createThread] Failed');
			this.setError('create_thread_failed');
			throw error;
		} finally {
			this.setLoading(false);
		}
	}

	/** Reset session-owned flags without changing the selected thread. */
	forgetChatSession(): void {
		this.sendRevision++;
		this.provisionalThreadBinding = null;
		this.isSending = false;
		this.awaitedTurn = null;
		this.error = null;
		this.shouldOpenWidget = false;
	}

	reset(): void {
		this.sendRevision++;
		this.provisionalThreadBinding = null;
		this.threadId = null;
		this.isNewConversation = false;
		this.isLoading = false;
		this.isSending = false;
		this.error = null;
		this.shouldOpenWidget = false;
		this.hasMore = false;
		this.continueCursor = null;
		this.awaitedTurn = null;
		this.streamCache.clear();
	}
}

export function createChatCore(options: ChatCoreOptions): ChatCore {
	return new ChatCore(options);
}
