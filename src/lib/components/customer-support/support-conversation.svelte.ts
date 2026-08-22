import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import type { Attachment } from '$lib/chat';
import type { ChatSessionPort } from '$lib/chat/core/chat-session-port.js';
import { ChatCommandError } from '$lib/chat/core/chat-command-error.js';
import { ChatDraftManager } from '$lib/chat/core/chat-draft-manager.svelte.ts';
import { StreamCacheManager } from '$lib/chat/core/stream-cache.js';
import { createOptimisticUpdate, type ListMessagesArgs } from '$lib/chat/core/optimistic.js';
import { CHAT_PAGE_SIZE } from '$lib/chat/core/types.js';
import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
import { isSupportAiEnabled } from '$lib/config/support';
import type { SupportNavigationState } from './support-navigation-state.svelte.ts';

export type SupportAssignedAdmin = { name?: string; image: string | null };

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
	private threadCreationPromise: Promise<string> | null = null;
	private sessionVersion = 0;

	constructor(private readonly navigation: SupportNavigationState) {}

	get awaitsAgentReply(): boolean {
		return !this.isHandedOff && isSupportAiEnabled();
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

	/** Stop an older warm-thread request from belonging to the active session. */
	invalidateWarmThreadAcquisition(): void {
		this.sessionVersion++;
		this.threadCreationPromise = null;
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
		if (this.threadCreationPromise) return this.threadCreationPromise;

		const requestedSession = this.sessionVersion;
		const creation = client
			.mutation(api.support.threads.getOrCreateWarmThread, {
				anonymousUserId: this.getAnonymousUserId(),
				pageUrl: typeof window !== 'undefined' ? window.location.href : undefined
			})
			.then((result) => {
				if (
					this.sessionVersion === requestedSession &&
					!this.threadId &&
					this.navigation.currentView === 'chat'
				) {
					// Null -> real is the same compose session: do not reset its draft,
					// attachments, generation, or new-conversation marker.
					this.threadId = result.threadId;
					this.notificationEmail = result.notificationEmail ?? null;
					this.navigation.emitThreadChange(result.threadId);
				}
				return result.threadId;
			})
			.finally(() => {
				if (this.threadCreationPromise === creation) this.threadCreationPromise = null;
			});

		this.threadCreationPromise = creation;
		return creation;
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

		this.setSending(true);
		let threadCreated = false;

		try {
			let threadId = options?.threadId ?? this.threadId;
			if (!threadId && this.threadCreationPromise) {
				try {
					threadId = await this.threadCreationPromise;
				} catch {
					// Preserve the existing send path: a failed eager warm-up is retried below.
				}
			}
			if (!threadId) {
				threadId = await this.ensureThread(client);
				threadCreated = true;
			} else if (!this.threadId) {
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

			if (this.awaitsAgentReply) this.isAwaitingStream = true;
			return { threadId, threadCreated };
		} catch (error) {
			console.error('[sendMessage] Failed:', error);
			this.setError('send_failed');
			throw error;
		} finally {
			this.setSending(false);
		}
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
