/** Headless chat state without UI dependencies. */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
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
import { SendOwnership, type SendClaim } from './send-ownership.js';
import {
	ChatConversation,
	type AwaitedTurn,
	type ChatSessionPort
} from './chat-session-port.svelte.ts';
import { ChatCommandError, type ChatCommandErrorCode } from './chat-command-error.js';

export type ChatCoreErrorCode = ChatCommandErrorCode | 'send_failed' | 'create_thread_failed';
type CreateThreadArgs = CreateThreadOptions & Record<string, unknown>;

type Empty = Record<never, never>;

type ChatSendOp = Data.TaggedEnum<{
	Idle: Empty;
	Locked: Empty;
	CreatingThread: Empty;
	Sending: { readonly threadId: string };
}>;
const ChatSendOp = Data.taggedEnum<ChatSendOp>();

const mutate = <A>(run: () => Promise<A>): Effect.Effect<A, unknown> =>
	Effect.tryPromise({ try: run, catch: (error) => error });

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
	#conversation = $state.raw(new ChatConversation());
	/** True while a new conversation starts, so suggestions show at once */
	isNewConversation = $state(false);

	isLoading = $state(false);
	#op = $state.raw<ChatSendOp>(ChatSendOp.Idle());

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
	readonly #ownership = new SendOwnership();

	constructor(options: ChatCoreOptions) {
		this.#conversation = new ChatConversation(options.threadId ?? null);
		this.isNewConversation = this.threadId === null;
		this.api = options.api;
		this.config = { ...DEFAULT_CHAT_CONFIG, ...options.config };
	}

	get conversation(): ChatConversation {
		return this.#conversation;
	}

	get threadId(): string | null {
		return this.#conversation.threadId;
	}

	get isSending(): boolean {
		return this.#op._tag !== 'Idle';
	}

	set isSending(sending: boolean) {
		if (!sending) this.#op = ChatSendOp.Idle();
		else if (this.#op._tag === 'Idle') this.#op = ChatSendOp.Locked();
	}

	get hasThread(): boolean {
		return this.threadId !== null;
	}

	get isAwaitingStream(): boolean {
		return this.awaitedTurn !== null;
	}

	setThread(threadId: string | null): void {
		if (threadId !== this.threadId) {
			this.#supersede();
			this.#conversation = new ChatConversation(threadId);
		}
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

	#supersede(): void {
		this.#ownership.supersede();
		this.#op = ChatSendOp.Idle();
		this.awaitedTurn = null;
	}

	#enter(claim: SendClaim, from: ChatSendOp['_tag'], next: ChatSendOp): void {
		if (this.#ownership.owns(claim) && this.#op._tag === from) this.#op = next;
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

		const claim = this.#ownership.claim();
		this.clearError();
		this.setSending(true);
		this.setAwaitingStream(true);

		let threadCreated: CreateThreadResult | undefined;
		let failureCode: ChatCoreErrorCode = 'send_failed';

		const program = Effect.gen({ self: this }, function* () {
			let threadId = this.threadId;
			if (threadId) {
				this.#enter(claim, 'Locked', ChatSendOp.Sending({ threadId }));
			} else {
				this.#enter(claim, 'Locked', ChatSendOp.CreatingThread());
				failureCode = 'create_thread_failed';
				const createThread = api.createThread;
				if (!createThread) {
					return yield* Effect.fail(
						new Error('Cannot send message: no thread and createThread not configured')
					);
				}

				const result = yield* mutate(() =>
					client.mutation(createThread, { ...options?.createThreadOptions })
				);
				if (!this.#ownership.owns(claim)) {
					return yield* Effect.fail(new Error('Chat session ended'));
				}

				threadId = result.threadId;
				threadCreated = result;
				// Assigned directly: setThread would clear streamCache, error, and the
				// pagination cursors
				this.#conversation.assign(threadId);
				this.isNewConversation = false;
				this.#enter(claim, 'CreatingThread', ChatSendOp.Sending({ threadId }));
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

			const result = yield* mutate(() =>
				client.mutation(
					api.sendMessage,
					{
						threadId,
						prompt: trimmedPrompt,
						userId: options?.userId,
						fileIds: options?.fileIds
					},
					mutationOptions
				)
			);
			return { ...result, threadCreated };
		});

		return this.#ownership.run(claim, program, {
			success: (result) => {
				// The reply, its stream or the notice replacing it lands at the saved
				// prompt's order; a wait already settled stays settled.
				if (this.awaitedTurn !== null) {
					this.awaitedTurn = { kind: 'accepted', order: result.order };
				}
				if (options?.openWidgetAfter) {
					this.requestWidgetOpen();
				}
			},
			failure: () => {
				console.error('[ChatCore.sendMessage] Failed');
				this.setError(failureCode);
				// Convex rolls the optimistic update back
				this.setAwaitingStream(false);
			},
			settle: () => this.setSending(false)
		});
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
		this.#supersede();
		this.error = null;
		this.shouldOpenWidget = false;
	}

	reset(): void {
		this.#supersede();
		this.#conversation = new ChatConversation();
		this.isNewConversation = false;
		this.isLoading = false;
		this.error = null;
		this.shouldOpenWidget = false;
		this.hasMore = false;
		this.continueCursor = null;
		this.streamCache.clear();
	}
}

export function createChatCore(options: ChatCoreOptions): ChatCore {
	return new ChatCore(options);
}
