import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import type { Attachment } from '$lib/chat';
import type { ChatSessionPort } from '$lib/chat/core/chat-session-port.js';
import { ChatCommandError } from '$lib/chat/core/chat-command-error.js';
import {
	ChatDraftManager,
	type ChatDraftCheckpoint
} from '$lib/chat/core/chat-draft-manager.svelte.ts';
import { getChatSessionEpoch, isChatSessionCurrent } from '$lib/chat/core/chat-persisted-state.ts';
import { StreamCacheManager } from '$lib/chat/core/stream-cache.js';
import { createOptimisticUpdate, type ListMessagesArgs } from '$lib/chat/core/optimistic.js';
import { CHAT_PAGE_SIZE } from '$lib/chat/core/types.js';
import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
import { isSupportAiEnabled } from '$lib/config/support';
import type { SupportNavigationState } from './support-navigation-state.svelte.ts';

export type SupportAssignedAdmin = { name?: string; image: string | null };

type ThreadCreation = {
	epoch: number;
	generation: number;
	navigationRevision: number;
	promise: Promise<string>;
};

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
	threadAgentName = $state<string | undefined>(undefined);
	isHandedOff = $state(false);
	assignedAdmin = $state<SupportAssignedAdmin | undefined>(undefined);
	notificationEmail = $state<string | null>(null);
	isLoading = $state(false);
	isSending = $state(false);
	error = $state<string | null>(null);
	threadGeneration = $state(0);
	isNewConversation = $state(false);
	hasMore = $state(false);
	continueCursor = $state<string | null>(null);
	isAwaitingStream = $state(false);
	readonly streamCache = new StreamCacheManager();
	rateLimitedUntil = $state<number | null>(null);

	private readonly draftManager = new ChatDraftManager('support');
	private client: ConvexClient | null = null;
	private threadCreation: ThreadCreation | null = null;
	private sendRevision = 0;
	private threadAcquisitionSendRevision: number | null = null;
	private bindThreadOrigin?: (threadId: string, epoch: number, generation: number) => void;

	constructor(
		private readonly navigation: SupportNavigationState,
		private readonly isAiUsable: () => boolean = () => true
	) {}

	get awaitsAgentReply(): boolean {
		return !this.isHandedOff && isSupportAiEnabled() && this.isAiUsable();
	}

	get hasThread(): boolean {
		return this.threadId !== null;
	}

	get currentAgentName(): string | undefined {
		return this.threadAgentName;
	}

	get isRateLimited(): boolean {
		return this.rateLimitedUntil !== null && Date.now() < this.rateLimitedUntil;
	}

	getAnonymousUserId(): string | undefined {
		return isAnonymousUser(this.userId) ? (this.userId ?? undefined) : undefined;
	}

	getDraft(threadId: string | null): string {
		return this.draftManager.getDraft(threadId);
	}

	setDraft(threadId: string | null, text: string): void {
		this.draftManager.setDraft(threadId, text);
	}

	clearDraft(threadId: string | null): void {
		this.draftManager.clearDraft(threadId);
	}

	captureDraftCheckpoint(threadId: string | null): ChatDraftCheckpoint {
		return this.draftManager.captureCheckpoint(threadId);
	}

	clearDraftIfUnchanged(
		checkpoint: ChatDraftCheckpoint,
		threadId: string | null = checkpoint.threadId
	): boolean {
		return this.draftManager.clearDraftIfUnchanged(checkpoint, threadId);
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

	setThreadAgentName(agentName: string | undefined): void {
		this.threadAgentName = agentName;
	}

	setAssignedAdmin(admin: SupportAssignedAdmin | undefined): void {
		this.assignedAdmin = admin;
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

	setLoading(loading: boolean): void {
		this.isLoading = loading;
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

	setThreadOriginBinder(
		binder: ((threadId: string, epoch: number, generation: number) => void) | undefined
	): void {
		this.bindThreadOrigin = binder;
	}

	isSendOperationCurrent(epoch: number, generation: number): boolean {
		return isChatSessionCurrent(epoch) && this.threadGeneration === generation;
	}

	private isSendOwnershipCurrent(
		epoch: number,
		generation: number,
		navigationRevision: number
	): boolean {
		return (
			this.isSendOperationCurrent(epoch, generation) &&
			this.navigation.operationRevision === navigationRevision
		);
	}

	private releaseAbandonedThreadAcquisition(): void {
		if (this.threadAcquisitionSendRevision !== this.sendRevision) return;
		this.threadAcquisitionSendRevision = null;
		this.isSending = false;
	}

	/** Stop an older warm-thread request from belonging to the active session. */
	invalidateWarmThreadAcquisition(): void {
		this.navigation.invalidateOperation();
		this.releaseAbandonedThreadAcquisition();
		this.threadCreation = null;
		this.threadAcquisitionSendRevision = null;
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
			this.invalidateWarmThreadAcquisition();
			this.isSending = false;
			this.isAwaitingStream = false;
		}
		this.threadId = threadId;
		this.threadAgentName = agentName;
		this.isHandedOff = isHandedOff ?? false;
		this.assignedAdmin = assignedAdmin;
		this.notificationEmail = notificationEmail ?? null;
		this.hasMore = false;
		this.continueCursor = null;
	}

	/** Adopt a URL-selected thread without resetting metadata loaded by the query. */
	selectThreadFromUrl(threadId: string): void {
		this.invalidateWarmThreadAcquisition();
		this.threadId = threadId;
		this.isNewConversation = false;
	}

	/** Begin a distinct compose session even when the previous thread was null. */
	beginNewConversation(): void {
		this.invalidateWarmThreadAcquisition();
		this.isSending = false;
		this.isAwaitingStream = false;
		this.threadId = null;
		this.threadAgentName = undefined;
		this.isHandedOff = false;
		this.assignedAdmin = undefined;
		this.notificationEmail = null;
		this.hasMore = false;
		this.continueCursor = null;
		this.isNewConversation = true;
		this.threadGeneration++;
	}

	/**
	 * Return the active thread or acquire one with a single in-flight mutation.
	 * A completion is adopted only by the session/view that requested it.
	 */
	async ensureThread(client: ConvexClient): Promise<string> {
		if (this.threadId) return this.threadId;

		const epoch = getChatSessionEpoch();
		const generation = this.threadGeneration;
		const navigationRevision = this.navigation.operationRevision;
		const current = this.threadCreation;
		if (
			current?.epoch === epoch &&
			current.generation === generation &&
			current.navigationRevision === navigationRevision
		) {
			return current.promise;
		}

		const creation = {} as ThreadCreation;
		creation.epoch = epoch;
		creation.generation = generation;
		creation.navigationRevision = navigationRevision;
		creation.promise = client
			.mutation(api.support.threads.getOrCreateWarmThread, {
				anonymousUserId: this.getAnonymousUserId(),
				pageUrl: typeof window !== 'undefined' ? window.location.href : undefined
			})
			.then((result) => {
				if (!this.isSendOwnershipCurrent(epoch, generation, navigationRevision)) {
					return result.threadId;
				}
				this.bindThreadOrigin?.(result.threadId, epoch, generation);
				if (!this.threadId && this.navigation.currentView === 'chat') {
					this.threadId = result.threadId;
					this.notificationEmail = result.notificationEmail ?? null;
					this.navigation.emitThreadChange(result.threadId);
				}
				return result.threadId;
			})
			.finally(() => {
				if (this.threadCreation === creation) this.threadCreation = null;
			});
		this.threadCreation = creation;
		return creation.promise;
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

		const sessionEpoch = getChatSessionEpoch();
		const generation = this.threadGeneration;
		const navigationRevision = this.navigation.operationRevision;
		const sendRevision = ++this.sendRevision;
		this.threadAcquisitionSendRevision = null;
		this.setSending(true);

		let threadCreated = false;
		let messageDispatched = false;

		try {
			let threadId = options?.threadId ?? this.threadId;
			if (!threadId) this.threadAcquisitionSendRevision = sendRevision;
			const inFlight = this.threadCreation;
			if (
				!threadId &&
				inFlight?.epoch === sessionEpoch &&
				inFlight.generation === generation &&
				inFlight.navigationRevision === navigationRevision
			) {
				try {
					threadId = await inFlight.promise;
				} catch (error) {
					if (!this.isSendOwnershipCurrent(sessionEpoch, generation, navigationRevision)) {
						throw error;
					}
				}
				if (!this.isSendOwnershipCurrent(sessionEpoch, generation, navigationRevision)) {
					throw new Error('Support conversation changed');
				}
			}

			if (!threadId) {
				threadId = await this.ensureThread(client);
				threadCreated = true;
			}
			if (!this.isSendOwnershipCurrent(sessionEpoch, generation, navigationRevision)) {
				throw new Error('Support conversation changed');
			}

			if (!this.threadId) {
				this.bindThreadOrigin?.(threadId, sessionEpoch, generation);
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

			if (!this.isSendOwnershipCurrent(sessionEpoch, generation, navigationRevision)) {
				throw new Error('Support conversation changed');
			}
			if (this.threadAcquisitionSendRevision === sendRevision) {
				this.threadAcquisitionSendRevision = null;
			}
			messageDispatched = true;
			await client.mutation(
				api.support.messages.sendMessage,
				{
					threadId,
					prompt: trimmedPrompt,
					anonymousUserId,
					fileIds: options?.fileIds?.length ? options.fileIds : undefined
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
			);
			if (!this.isSendOperationCurrent(sessionEpoch, generation)) {
				throw new Error('Support conversation changed');
			}

			if (this.awaitsAgentReply) this.isAwaitingStream = true;
			return { threadId, threadCreated };
		} catch (error) {
			const operationCurrent = messageDispatched
				? this.isSendOperationCurrent(sessionEpoch, generation)
				: this.isSendOwnershipCurrent(sessionEpoch, generation, navigationRevision);
			if (operationCurrent) {
				console.error('[sendMessage] Failed:', error);
				this.setError('send_failed');
			}
			throw error;
		} finally {
			if (this.threadAcquisitionSendRevision === sendRevision) {
				this.threadAcquisitionSendRevision = null;
			}
			const operationCurrent = messageDispatched
				? this.isSendOperationCurrent(sessionEpoch, generation)
				: this.isSendOwnershipCurrent(sessionEpoch, generation, navigationRevision);
			if (operationCurrent && this.sendRevision === sendRevision) this.setSending(false);
		}
	}

	forgetChatSession(): void {
		this.sendRevision++;
		this.threadCreation = null;
		this.threadAcquisitionSendRevision = null;
		this.isSending = false;
		this.isAwaitingStream = false;
		this.error = null;
		this.rateLimitedUntil = null;
	}

	reset(): void {
		this.invalidateWarmThreadAcquisition();
		this.userId = null;
		this.threadId = null;
		this.threadAgentName = undefined;
		this.isHandedOff = false;
		this.assignedAdmin = undefined;
		this.notificationEmail = null;
		this.isLoading = false;
		this.isSending = false;
		this.error = null;
		this.isNewConversation = false;
		this.hasMore = false;
		this.continueCursor = null;
	}
}
