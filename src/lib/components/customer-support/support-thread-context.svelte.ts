import { Context } from 'runed';
import type { ConvexClient } from 'convex/browser';
import type { Attachment } from '$lib/chat';
import type { StreamCachePort } from '$lib/chat/core/chat-session-port.js';
import { SupportConversation, type SupportAssignedAdmin } from './support-conversation.svelte.ts';
import { SupportHandoffCommands } from './support-handoff-commands.svelte.ts';
import { SupportNavigationState } from './support-navigation-state.svelte.ts';
import { SupportNotificationCommands } from './support-notification-commands.svelte.ts';
import type {
	NotificationEmailOutcome,
	SupportHandoffOutcome,
	SupportView
} from './support-types.js';

export type {
	NotificationEmailOutcome,
	SupportHandoffOutcome,
	SupportView
} from './support-types.js';

/**
 * Customer-support composition root.
 *
 * The existing surface remains as a bounded compatibility facade while
 * ownership moves to focused collaborators. Consumer migration will remove
 * the redundant forwards once each call site uses its intentional surface.
 */
export class SupportThreadContext {
	readonly navigation: SupportNavigationState;
	readonly conversation: SupportConversation;
	readonly handoff: SupportHandoffCommands;
	readonly notifications: SupportNotificationCommands;

	constructor() {
		this.navigation = new SupportNavigationState();
		this.conversation = new SupportConversation(this.navigation);
		this.handoff = new SupportHandoffCommands(this.conversation);
		this.notifications = new SupportNotificationCommands(this.conversation);
	}

	// Temporary compatibility facade; remove these forwards after consumer migration.
	get userId(): string | null {
		return this.conversation.userId;
	}
	set userId(value: string | null) {
		this.conversation.setUserId(value);
	}

	get currentView(): SupportView {
		return this.navigation.currentView;
	}
	set currentView(value: SupportView) {
		if (value !== 'chat' && !this.conversation.hasThread) {
			this.conversation.invalidateWarmThreadAcquisition();
		}
		this.navigation.setView(value);
	}

	get threadId(): string | null {
		return this.conversation.threadId;
	}
	set threadId(value: string | null) {
		this.conversation.setThread(value);
	}

	get threadAgentName(): string | undefined {
		return this.conversation.threadAgentName;
	}
	set threadAgentName(value: string | undefined) {
		this.conversation.setThreadAgentName(value);
	}

	get isHandedOff(): boolean {
		return this.conversation.isHandedOff;
	}
	set isHandedOff(value: boolean) {
		this.conversation.setHandedOff(value);
	}

	get assignedAdmin(): SupportAssignedAdmin | undefined {
		return this.conversation.assignedAdmin;
	}
	set assignedAdmin(value: SupportAssignedAdmin | undefined) {
		this.conversation.setAssignedAdmin(value);
	}

	get notificationEmail(): string | null {
		return this.conversation.notificationEmail;
	}
	set notificationEmail(value: string | null) {
		this.conversation.setNotificationEmail(value);
	}

	get isEmailPending(): boolean {
		return this.notifications.isPending;
	}
	set isEmailPending(value: boolean) {
		this.notifications.isPending = value;
	}

	get isLoading(): boolean {
		return this.conversation.isLoading;
	}
	set isLoading(value: boolean) {
		this.conversation.setLoading(value);
	}

	get isSending(): boolean {
		return this.conversation.isSending;
	}
	set isSending(value: boolean) {
		this.conversation.setSending(value);
	}

	get error(): string | null {
		return this.conversation.error;
	}
	set error(value: string | null) {
		this.conversation.setError(value);
	}

	get shouldOpenWidget(): boolean {
		return this.navigation.shouldOpenWidget;
	}
	set shouldOpenWidget(value: boolean) {
		this.navigation.shouldOpenWidget = value;
	}

	get skipAnimation(): boolean {
		return this.navigation.skipAnimation;
	}
	set skipAnimation(value: boolean) {
		this.navigation.skipAnimation = value;
	}

	get threadGeneration(): number {
		return this.conversation.threadGeneration;
	}
	set threadGeneration(value: number) {
		this.conversation.threadGeneration = value;
	}

	get isNewConversation(): boolean {
		return this.conversation.isNewConversation;
	}
	set isNewConversation(value: boolean) {
		this.conversation.setNewConversation(value);
	}

	get hasMore(): boolean {
		return this.conversation.hasMore;
	}
	set hasMore(value: boolean) {
		this.conversation.hasMore = value;
	}

	get continueCursor(): string | null {
		return this.conversation.continueCursor;
	}
	set continueCursor(value: string | null) {
		this.conversation.continueCursor = value;
	}

	get isAwaitingStream(): boolean {
		return this.conversation.isAwaitingStream;
	}
	set isAwaitingStream(value: boolean) {
		this.conversation.setAwaitingStream(value);
	}

	get streamCache(): StreamCachePort {
		return this.conversation.streamCache;
	}

	get rateLimitedUntil(): number | null {
		return this.conversation.rateLimitedUntil;
	}
	set rateLimitedUntil(value: number | null) {
		this.conversation.rateLimitedUntil = value;
	}

	get awaitsAgentReply(): boolean {
		return this.conversation.awaitsAgentReply;
	}

	get hasThread(): boolean {
		return this.conversation.hasThread;
	}

	get currentAgentName(): string | undefined {
		return this.conversation.currentAgentName;
	}

	get isRateLimited(): boolean {
		return this.conversation.isRateLimited;
	}

	getDraft(threadId: string | null): string {
		return this.conversation.getDraft(threadId);
	}

	setDraft(threadId: string | null, text: string): void {
		this.conversation.setDraft(threadId, text);
	}

	clearDraft(threadId: string | null): void {
		this.conversation.clearDraft(threadId);
	}

	setRateLimited(retryAfterMs: number): void {
		this.conversation.setRateLimited(retryAfterMs);
	}

	clearRateLimit(): void {
		this.conversation.clearRateLimit();
	}

	setClient(client: ConvexClient): void {
		this.conversation.setClient(client);
	}

	ensureThread(client: ConvexClient): Promise<string> {
		return this.conversation.ensureThread(client);
	}

	setAwaitingStream(awaiting: boolean): void {
		this.conversation.setAwaitingStream(awaiting);
	}

	setThread(
		threadId: string | null,
		agentName?: string,
		isHandedOff?: boolean,
		assignedAdmin?: SupportAssignedAdmin,
		notificationEmail?: string | null
	): void {
		this.conversation.setThread(threadId, agentName, isHandedOff, assignedAdmin, notificationEmail);
	}

	setHandedOff(isHandedOff: boolean): void {
		this.conversation.setHandedOff(isHandedOff);
	}

	requestHandoff(client: ConvexClient): Promise<SupportHandoffOutcome> {
		return this.handoff.request(client);
	}

	setNotificationEmail(client: ConvexClient, email: string): Promise<NotificationEmailOutcome> {
		return this.notifications.setEmail(client, email);
	}

	sendMessage(
		client: ConvexClient,
		prompt: string,
		options?: { fileIds?: string[]; attachments?: Attachment[]; threadId?: string }
	): Promise<{ threadId: string; threadCreated: boolean }> {
		return this.conversation.sendMessage(client, prompt, options);
	}

	setLoading(loading: boolean): void {
		this.conversation.setLoading(loading);
	}

	setSending(sending: boolean): void {
		this.conversation.setSending(sending);
	}

	setError(error: string | null): void {
		this.conversation.setError(error);
	}

	clearError(): void {
		this.conversation.clearError();
	}

	requestWidgetOpen(): void {
		this.navigation.requestWidgetOpen(this.conversation.hasThread);
	}

	clearWidgetOpenRequest(): void {
		this.navigation.clearWidgetOpenRequest();
	}

	setUserId(userId: string | null): void {
		this.conversation.setUserId(userId);
	}

	setOnThreadChange(callback: ((threadId: string | null) => void) | undefined): void {
		this.navigation.setOnThreadChange(callback);
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

		void this.conversation.ensureConfiguredThread()?.catch((error) => {
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

	reset(): void {
		this.navigation.reset();
		this.conversation.reset();
		this.notifications.reset();
	}
}

/** One feature-level provider; collaborators are reached through this root. */
export const supportThreadContext = new Context<SupportThreadContext>('support-thread');
