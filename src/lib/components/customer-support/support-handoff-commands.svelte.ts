import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import { createOptimisticUpdate, type ListMessagesArgs } from '$lib/chat/core/optimistic.js';
import { CHAT_PAGE_SIZE } from '$lib/chat/core/types.js';
import type { SupportOperationIdentity } from './support-conversation.svelte.ts';
import type { SupportHandoffOutcome } from './support-types.js';

export interface SupportHandoffConversationPort {
	readonly threadId: string | null;
	getAnonymousUserId(): string | undefined;
	captureOperationIdentity(): SupportOperationIdentity;
	isOperationIdentityCurrent(identity: SupportOperationIdentity): boolean;
	setHandedOff(isHandedOff: boolean): void;
	setError(error: string | null): void;
	clearError(): void;
}

/** Handoff mutation behavior separated from conversation/session ownership. */
export class SupportHandoffCommands {
	constructor(private readonly conversation: SupportHandoffConversationPort) {}

	async request(client: ConvexClient): Promise<SupportHandoffOutcome> {
		const threadId = this.conversation.threadId;
		if (!threadId) {
			console.error('[requestHandoff] No thread ID');
			return { kind: 'missing_thread' };
		}

		const operation = this.conversation.captureOperationIdentity();
		this.conversation.setHandedOff(true);
		try {
			const anonymousUserId = this.conversation.getAnonymousUserId();
			const queryArgs: ListMessagesArgs = {
				threadId,
				...(anonymousUserId ? { anonymousUserId } : {}),
				paginationOpts: { numItems: CHAT_PAGE_SIZE, cursor: null },
				streamArgs: { kind: 'list' as const, startOrder: 0 }
			};

			await client.mutation(
				api.support.threads.updateThreadHandoff,
				{ threadId, anonymousUserId },
				{
					optimisticUpdate: createOptimisticUpdate(
						api.support.messages.listMessages,
						queryArgs,
						'user',
						'Talk to support'
					)
				}
			);
			if (!this.conversation.isOperationIdentityCurrent(operation)) return { kind: 'stale' };
			this.conversation.clearError();
			return { kind: 'applied' };
		} catch {
			if (!this.conversation.isOperationIdentityCurrent(operation)) return { kind: 'stale' };
			this.conversation.setHandedOff(false);
			console.error('[SupportHandoffCommands.request] Failed');
			this.conversation.setError('handoff_failed');
			return { kind: 'failed', code: 'handoff_failed' };
		}
	}
}
