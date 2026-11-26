import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { version } from '$app/env';
import { api } from '#lib/convex/_generated/api.js';
import type { Attachment } from '#lib/chat/index.js';
import {
	ChatConversation,
	type AwaitedTurn,
	type ChatSessionPort,
	type StreamCachePort
} from '#lib/chat/core/chat-session-port.svelte.ts';
import { ChatCommandError } from '#lib/chat/core/chat-command-error.js';
import { ChatDraftManager } from '#lib/chat/core/chat-draft-manager.svelte.ts';
import { getChatSessionEpoch, isChatSessionCurrent } from '#lib/chat/core/chat-persisted-state.ts';
import { KeyedAcquisition } from '#lib/chat/core/keyed-acquisition.js';
import { SendOwnership, type SendClaim } from '#lib/chat/core/send-ownership.js';
import { StreamCacheManager } from '#lib/chat/core/stream-cache.js';
import { createOptimisticUpdate, type ListMessagesArgs } from '#lib/chat/core/optimistic.js';
import { CHAT_PAGE_SIZE } from '#lib/chat/core/types.js';
import { isAnonymousUser } from '#lib/confect/utils/anonymousUser.js';
import { isSupportAiEnabled } from '#lib/config/support.js';
import { normalizeSupportPageRoute } from '#lib/shared/support-page-route.js';
import type { SupportNavigationState } from './support-navigation-state.svelte.ts';

// Support's send returns no prompt order, and the handoff acknowledgement and
// team replies are saved at the thread's latest order rather than the
// prompt's, so the wait settles on any assistant response after the prompt.
const UNORDERED_TURN: AwaitedTurn = { kind: 'unordered' };

export type SupportAssignedAdmin = { name?: string; image: string | null };

/** Thread metadata from a validated `getThread` read. */
export type SupportThreadMetadata = Pick<
	FunctionReturnType<typeof api.support.threads.getThread>,
	'isHandedOff' | 'assignedAdmin' | 'notificationEmail'
>;

export type SupportOperationIdentity = {
	threadId: string | null;
	generation: number;
	operationRevision: number;
};

type Empty = Record<never, never>;

type SupportSendOp = Data.TaggedEnum<{
	Idle: Empty;
	Locked: Empty;
	Sending: Empty;
}>;
const SupportSendOp = Data.taggedEnum<SupportSendOp>();

type AcquisitionWait = Data.TaggedEnum<{
	None: Empty;
	Waiting: { readonly claim: SendClaim };
}>;
const AcquisitionWait = Data.taggedEnum<AcquisitionWait>();

type SupportScope = {
	readonly epoch: number;
	readonly generation: number;
	readonly operation: number;
	readonly navigation: number;
};

const sameScope = (a: SupportScope, b: SupportScope): boolean =>
	a.epoch === b.epoch &&
	a.generation === b.generation &&
	a.operation === b.operation &&
	a.navigation === b.navigation;

const mutate = <A>(run: () => Promise<A>): Effect.Effect<A, unknown> =>
	Effect.tryPromise({ try: run, catch: (error) => error });

const conversationChanged = () => Effect.fail(new Error('Support conversation changed'));

/**
 * Conversation/session owner for customer support.
 *
 * This is the only support collaborator that implements the shared chat port.
 * Navigation is an explicit dependency used only for current-session adoption
 * and URL notification; support-only commands depend on this class through
 * narrow command ports in their own modules.
 */
export class SupportConversation implements ChatSessionPort {
	userId = $state<string | null>(null);
	threadId = $state<string | null>(null);
	#conversation = $state.raw(new ChatConversation());
	threadAgentName = $state<string | undefined>(undefined);
	isHandedOff = $state(false);
	assignedAdmin = $state<SupportAssignedAdmin | undefined>(undefined);
	notificationEmail = $state<string | null>(null);
	#op = $state.raw<SupportSendOp>(SupportSendOp.Idle());
	error = $state<string | null>(null);
	threadGeneration = $state(0);
	isNewConversation = $state(false);
	isAwaitingStream = $state(false);
	rateLimitedUntil = $state<number | null>(null);

	/**
	 * Cache entries are keyed by thread-local message order, so the cache holds
	 * one thread at a time. Access after an established thread changes drops the
	 * old entries; provisional null-to-thread adoption keeps the first stream's.
	 */
	readonly streamCache: StreamCachePort = {
		getCachedReasoning: (order) => this.currentStreamCache().getCachedReasoning(order),
		updateReasoningCache: (order, reasoning) =>
			this.currentStreamCache().updateReasoningCache(order, reasoning),
		clearReasoningCache: (order) => this.currentStreamCache().clearReasoningCache(order)
	};

	private readonly threadStreamCache = new StreamCacheManager();
	private streamCacheThreadId: string | null = null;
	readonly drafts = new ChatDraftManager('support');
	private client: ConvexClient | null = null;
	private operationRevision = 0;
	readonly #ownership = new SendOwnership({
		generation: () => this.threadGeneration,
		operation: () => this.operationRevision
	});
	readonly #acquisition = new KeyedAcquisition<SupportScope, string>(sameScope);
	#wait: AcquisitionWait = AcquisitionWait.None();

	constructor(
		private readonly navigation: SupportNavigationState,
		private readonly isAiUsable: () => boolean = () => true
	) {}

	get awaitsAgentReply(): boolean {
		return !this.isHandedOff && isSupportAiEnabled() && this.isAiUsable();
	}

	get conversation(): ChatConversation {
		return this.#conversation;
	}

	get isSending(): boolean {
		return this.#op._tag !== 'Idle';
	}

	set isSending(sending: boolean) {
		if (!sending) this.#op = SupportSendOp.Idle();
		else if (this.#op._tag === 'Idle') this.#op = SupportSendOp.Locked();
	}

	get hasThread(): boolean {
		return this.threadId !== null;
	}

	get awaitedTurn(): AwaitedTurn | null {
		return this.isAwaitingStream ? UNORDERED_TURN : null;
	}

	get currentAgentName(): string | undefined {
		return this.threadAgentName;
	}

	get isRateLimited(): boolean {
		return this.rateLimitedUntil !== null && Date.now() < this.rateLimitedUntil;
	}

	private currentStreamCache(): StreamCacheManager {
		if (this.threadId !== this.streamCacheThreadId) {
			if (this.streamCacheThreadId !== null) this.threadStreamCache.clear();
			this.streamCacheThreadId = this.threadId;
		}
		return this.threadStreamCache;
	}

	getAnonymousUserId(): string | undefined {
		return isAnonymousUser(this.userId) ? (this.userId ?? undefined) : undefined;
	}

	getDraft(threadId: string | null): string {
		return this.drafts.getDraft(threadId);
	}

	setDraft(threadId: string | null, text: string): void {
		this.drafts.setDraft(threadId, text);
	}

	setRateLimited(retryAfterMs: number): void {
		this.rateLimitedUntil = Date.now() + retryAfterMs;
	}

	clearRateLimit(): void {
		this.rateLimitedUntil = null;
	}

	setClient(client: ConvexClient): void {
		this.client = client;
	}

	setUserId(userId: string | null): void {
		this.userId = userId;
	}

	setNotificationEmail(email: string | null): void {
		this.notificationEmail = email;
	}

	setNewConversation(isNewConversation: boolean): void {
		this.isNewConversation = isNewConversation;
	}

	setAwaitingStream(awaiting: boolean): void {
		this.isAwaitingStream = awaiting;
	}

	setSending(sending: boolean): void {
		this.isSending = sending;
	}

	setError(error: string | null): void {
		this.error = error;
	}

	clearError(): void {
		this.error = null;
	}

	setHandedOff(isHandedOff: boolean): void {
		this.isHandedOff = isHandedOff;
	}

	get currentOperationRevision(): number {
		return this.operationRevision;
	}

	isSendOperationCurrent(
		epoch: number,
		generation: number,
		operationRevision = this.operationRevision
	): boolean {
		return (
			isChatSessionCurrent(epoch) &&
			this.threadGeneration === generation &&
			this.operationRevision === operationRevision
		);
	}

	captureOperationIdentity(): SupportOperationIdentity {
		return {
			threadId: this.threadId,
			generation: this.threadGeneration,
			operationRevision: this.operationRevision
		};
	}

	isOperationIdentityCurrent(identity: SupportOperationIdentity): boolean {
		return (
			this.threadId === identity.threadId &&
			this.threadGeneration === identity.generation &&
			this.operationRevision === identity.operationRevision
		);
	}

	#scope(): SupportScope {
		return {
			epoch: getChatSessionEpoch(),
			generation: this.threadGeneration,
			operation: this.operationRevision,
			navigation: this.navigation.operationRevision
		};
	}

	#admits(scope: SupportScope): boolean {
		return sameScope(scope, this.#scope());
	}

	#enter(claim: SendClaim, from: SupportSendOp['_tag'], next: SupportSendOp): void {
		if (this.#ownership.owns(claim) && this.#op._tag === from) this.#op = next;
	}

	#endWait(claim: SendClaim): void {
		if (this.#wait._tag === 'Waiting' && this.#wait.claim === claim) {
			this.#wait = AcquisitionWait.None();
		}
	}

	/** Stop an older warm-thread request from belonging to the active session. */
	invalidateWarmThreadAcquisition(): void {
		this.navigation.invalidateOperation();
		if (this.#wait._tag === 'Waiting' && this.#ownership.isLatest(this.#wait.claim)) {
			this.isSending = false;
		}
		this.#acquisition.invalidate();
		this.#wait = AcquisitionWait.None();
	}

	/**
	 * Initialize or load an established thread.
	 * Cross-thread changes invalidate stale warm-thread work and clear the old
	 * send lock; re-entering the same thread preserves its active stream lock.
	 */
	setThread(
		threadId: string | null,
		agentName?: string,
		isHandedOff?: boolean,
		assignedAdmin?: SupportAssignedAdmin,
		notificationEmail?: string | null
	): void {
		if (threadId !== this.threadId) {
			const establishedThreadChanged = this.threadId !== null;
			this.invalidateWarmThreadAcquisition();
			this.#ownership.supersede();
			this.operationRevision++;
			if (establishedThreadChanged) this.threadGeneration++;
			this.isSending = false;
			this.isAwaitingStream = false;
			this.#conversation = new ChatConversation(threadId);
		}
		this.threadId = threadId;
		this.threadAgentName = agentName;
		this.isHandedOff = isHandedOff ?? false;
		this.assignedAdmin = assignedAdmin;
		this.notificationEmail = notificationEmail ?? null;
	}

	/**
	 * Adopt a URL-selected thread. A different thread takes the metadata of its
	 * validated read, or none without one; the thread already selected keeps the
	 * metadata and send lock it has loaded.
	 */
	selectThreadFromUrl(threadId: string, metadata?: SupportThreadMetadata): void {
		if (threadId !== this.threadId) {
			const establishedThreadChanged = this.threadId !== null;
			this.invalidateWarmThreadAcquisition();
			this.#ownership.supersede();
			this.operationRevision++;
			if (establishedThreadChanged) this.threadGeneration++;
			this.isSending = false;
			this.isAwaitingStream = false;
			this.threadAgentName = undefined;
			this.isHandedOff = metadata?.isHandedOff ?? false;
			this.assignedAdmin = metadata?.assignedAdmin;
			this.notificationEmail = metadata?.notificationEmail ?? null;
			this.#conversation = new ChatConversation(threadId);
		}
		this.threadId = threadId;
		this.isNewConversation = false;
	}

	/** Begin a distinct compose session even when the previous thread was null. */
	beginNewConversation(): void {
		this.invalidateWarmThreadAcquisition();
		this.#ownership.supersede();
		this.operationRevision++;
		this.isSending = false;
		this.isAwaitingStream = false;
		this.threadId = null;
		this.#conversation = new ChatConversation();
		this.threadAgentName = undefined;
		this.isHandedOff = false;
		this.assignedAdmin = undefined;
		this.notificationEmail = null;
		this.isNewConversation = true;
		this.threadGeneration++;
	}

	/**
	 * Return the active thread or acquire one with a single in-flight mutation.
	 * A completion is adopted only by the session/view that requested it.
	 */
	async ensureThread(client: ConvexClient): Promise<string> {
		if (this.threadId) return this.threadId;

		const scope = this.#scope();
		const conversation = this.#conversation;
		return this.#acquisition.acquire(scope, () =>
			client
				.mutation(api.support.threads.getOrCreateWarmThread, {
					anonymousUserId: this.getAnonymousUserId(),
					pageUrl: typeof window !== 'undefined' ? window.location.href : undefined
				})
				.then((result) => {
					if (!this.#admits(scope)) return result.threadId;
					if (conversation.threadId === null) conversation.assign(result.threadId);
					if (!this.threadId && this.navigation.currentView === 'chat') {
						this.threadId = result.threadId;
						this.notificationEmail = result.notificationEmail ?? null;
						this.navigation.emitThreadChange(result.threadId);
					}
					return result.threadId;
				})
		);
	}

	ensureConfiguredThread(): Promise<string> | null {
		return this.client ? this.ensureThread(this.client) : null;
	}

	async sendMessage(
		client: ConvexClient,
		prompt: string,
		options?: {
			fileIds?: string[];
			attachments?: Attachment[];
			threadId?: string;
		}
	): Promise<{ threadId: string; threadCreated: boolean }> {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) throw new ChatCommandError('empty_input');
		if (this.awaitsAgentReply && (this.isSending || this.isAwaitingStream)) {
			throw new ChatCommandError('send_in_progress');
		}

		const scope = this.#scope();
		const conversation = this.#conversation;
		const claim = this.#ownership.claim();
		this.#wait = AcquisitionWait.None();
		this.setSending(true);
		this.#enter(claim, 'Locked', SupportSendOp.Sending());

		let threadCreated = false;

		const program = Effect.gen({ self: this }, function* () {
			let threadId = options?.threadId ?? this.threadId;
			if (!threadId) this.#wait = AcquisitionWait.Waiting({ claim });
			const joined = threadId ? undefined : this.#acquisition.current(scope);
			if (joined) {
				threadId = yield* mutate(() => joined).pipe(
					Effect.catchCause((cause) =>
						this.#admits(scope) ? Effect.succeed(null) : Effect.failCause(cause)
					)
				);
				if (!this.#admits(scope)) return yield* conversationChanged();
			}

			if (!threadId) {
				threadId = yield* mutate(() => this.ensureThread(client));
				threadCreated = true;
			}
			if (!this.#admits(scope)) return yield* conversationChanged();

			if (!this.threadId) {
				if (conversation.threadId === null) conversation.assign(threadId);
				this.threadId = threadId;
				this.navigation.showChat();
			}

			const anonymousUserId = this.getAnonymousUserId();
			const queryArgs: ListMessagesArgs = {
				threadId,
				...(anonymousUserId ? { anonymousUserId } : {}),
				paginationOpts: { numItems: CHAT_PAGE_SIZE, cursor: null },
				streamArgs: { kind: 'list' as const, startOrder: 0 }
			};

			if (!this.#admits(scope)) return yield* conversationChanged();
			this.#endWait(claim);
			const sentThreadId = threadId;
			yield* mutate(() =>
				client.mutation(
					api.support.messages.sendMessage,
					{
						threadId: sentThreadId,
						prompt: trimmedPrompt,
						anonymousUserId,
						fileIds: options?.fileIds?.length ? options.fileIds : undefined,
						// Read per message because the thread keeps only the route
						// captured before its first message.
						pageUrl: normalizeSupportPageRoute(
							typeof window !== 'undefined' ? window.location.pathname : undefined
						),
						// The bundle this tab runs, which a stale tab keeps after a deploy.
						appVersion: version
					},
					{
						optimisticUpdate: createOptimisticUpdate(
							api.support.messages.listMessages,
							queryArgs,
							'user',
							trimmedPrompt,
							{
								attachments: options?.attachments?.length ? options.attachments : undefined
							}
						)
					}
				)
			);
			return { threadId: sentThreadId, threadCreated };
		});

		return this.#ownership.run(claim, program, {
			success: () => {
				if (this.awaitsAgentReply) this.isAwaitingStream = true;
			},
			failure: () => {
				console.error('[SupportConversation.sendMessage] Failed');
				this.setError('send_failed');
			},
			release: () => this.#endWait(claim),
			settle: () => this.setSending(false)
		});
	}

	forgetChatSession(): void {
		this.#ownership.supersede();
		this.operationRevision++;
		this.#acquisition.invalidate();
		this.#wait = AcquisitionWait.None();
		this.isSending = false;
		this.isAwaitingStream = false;
		this.error = null;
		this.rateLimitedUntil = null;
	}

	reset(): void {
		this.invalidateWarmThreadAcquisition();
		this.#ownership.supersede();
		this.operationRevision++;
		this.userId = null;
		this.threadId = null;
		this.#conversation = new ChatConversation();
		this.threadAgentName = undefined;
		this.isHandedOff = false;
		this.assignedAdmin = undefined;
		this.notificationEmail = null;
		this.isSending = false;
		this.error = null;
		this.isNewConversation = false;
	}
}
