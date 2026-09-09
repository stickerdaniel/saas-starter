import { Context } from 'runed';
import { getChatSessionEpoch } from '$lib/chat/core/chat-persisted-state.ts';
import { SupportConversation, type SupportAssignedAdmin } from './support-conversation.svelte.ts';
import { SupportHandoffCommands } from './support-handoff-commands.svelte.ts';
import { SupportNavigationState } from './support-navigation-state.svelte.ts';
import { SupportNotificationCommands } from './support-notification-commands.svelte.ts';

/**
 * Customer-support composition root.
 *
 * Components reach focused state and commands through the owned collaborators.
 * This root retains only feature actions that intentionally coordinate more
 * than one collaborator.
 */
export class SupportContext {
	readonly navigation: SupportNavigationState;
	readonly conversation: SupportConversation;
	readonly handoff: SupportHandoffCommands;
	readonly notifications: SupportNotificationCommands;

	constructor(isAiUsable: () => boolean = () => true) {
		this.navigation = new SupportNavigationState();
		this.conversation = new SupportConversation(this.navigation, isAiUsable);
		this.handoff = new SupportHandoffCommands(this.conversation);
		this.notifications = new SupportNotificationCommands(this.conversation);
	}

	requestWidgetOpen(): void {
		this.navigation.requestWidgetOpen(this.conversation.hasThread);
	}

	selectThread(
		threadId: string,
		agentName?: string,
		isHandedOff?: boolean,
		assignedAdmin?: SupportAssignedAdmin,
		notificationEmail?: string | null
	): void {
		this.conversation.setThread(threadId, agentName, isHandedOff, assignedAdmin, notificationEmail);
		this.conversation.setNewConversation(false);
		this.navigation.selectThread(threadId);
	}

	selectThreadFromUrl(threadId: string): void {
		this.conversation.selectThreadFromUrl(threadId);
		this.navigation.selectThreadFromUrl();
	}

	startNewThread(): void {
		this.conversation.beginNewConversation();
		this.navigation.startNewThread();
		const epoch = getChatSessionEpoch();
		const generation = this.conversation.threadGeneration;
		const navigationRevision = this.navigation.operationRevision;

		void this.conversation.ensureConfiguredThread()?.catch((error) => {
			if (
				!this.conversation.isSendOperationCurrent(epoch, generation) ||
				this.navigation.operationRevision !== navigationRevision
			) {
				return;
			}
			console.error('[startNewThread] Thread creation failed:', error);
			this.conversation.setError('thread_start_failed');
		});
	}

	goBack(): void {
		if (!this.conversation.hasThread) {
			this.conversation.invalidateWarmThreadAcquisition();
		}
		this.navigation.goBack();
	}
}

/** One feature-level provider; collaborators are reached through this root. */
export const supportContext = new Context<SupportContext>('customer-support');
