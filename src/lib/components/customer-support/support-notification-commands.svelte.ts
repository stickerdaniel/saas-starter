import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import type { SupportOperationIdentity } from './support-conversation.svelte.ts';
import type { NotificationEmailOutcome } from './support-types.js';

export interface SupportNotificationConversationPort {
	readonly threadId: string | null;
	readonly notificationEmail: string | null;
	getAnonymousUserId(): string | undefined;
	captureOperationIdentity(): SupportOperationIdentity;
	isOperationIdentityCurrent(identity: SupportOperationIdentity): boolean;
	setNotificationEmail(email: string | null): void;
	setError(error: string | null): void;
	clearError(): void;
}

/** Notification-email command and its in-flight state. */
export class SupportNotificationCommands {
	isPending = $state(false);
	private operationRevision = 0;

	constructor(private readonly conversation: SupportNotificationConversationPort) {}

	async setEmail(client: ConvexClient, email: string): Promise<NotificationEmailOutcome> {
		const threadId = this.conversation.threadId;
		if (!threadId) {
			console.error('[setNotificationEmail] No thread ID');
			return { kind: 'missing_thread' };
		}

		const normalizedEmail = email.trim().toLowerCase();
		const operation = this.conversation.captureOperationIdentity();
		const operationRevision = ++this.operationRevision;
		this.isPending = true;
		try {
			const anonymousUserId = this.conversation.getAnonymousUserId();
			const queryArgs = { threadId, anonymousUserId };
			await client.mutation(
				api.support.threads.updateNotificationEmail,
				{ threadId, email: normalizedEmail, anonymousUserId },
				{
					optimisticUpdate: (store) => {
						const current = store.getQuery(api.support.threads.getThread, queryArgs);
						if (current !== undefined) {
							store.setQuery(api.support.threads.getThread, queryArgs, {
								...current,
								notificationEmail: normalizedEmail || undefined
							});
						}
					}
				}
			);

			if (!this.conversation.isOperationIdentityCurrent(operation)) return { kind: 'stale' };
			this.conversation.setNotificationEmail(normalizedEmail || null);
			this.conversation.clearError();
			return { kind: 'saved', email: this.conversation.notificationEmail };
		} catch {
			if (!this.conversation.isOperationIdentityCurrent(operation)) return { kind: 'stale' };
			console.error('[SupportNotificationCommands.setEmail] Failed');
			this.conversation.setError('notification_update_failed');
			return { kind: 'failed', code: 'notification_update_failed' };
		} finally {
			if (this.operationRevision === operationRevision) this.isPending = false;
		}
	}

	reset(): void {
		this.operationRevision++;
		this.isPending = false;
	}
}
