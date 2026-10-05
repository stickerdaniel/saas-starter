import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import { ChatCore, type ChatCoreOptions } from '../core/chat-core.svelte.ts';
import { ChatDraftManager } from '../core/chat-draft-manager.svelte.ts';
import { getChatSessionEpoch, isChatSessionCurrent } from '../core/chat-persisted-state.ts';
import type { ChatInputProjection, ChatUIContext } from '../ui/chat-context.svelte.ts';
import { ComposerSendCoordinator } from '../ui/composer-send-coordinator.ts';

const SIMPLE_CHAT_API = {
	sendMessage: api.aiChat.messages.sendMessage,
	listMessages: api.aiChat.messages.listMessages
};

const clientRegistries = new WeakMap<ConvexClient, SimpleChatSessionRegistry>();

export type SimpleChatOwner = object;

export type SimpleChatRegistryLease = {
	registry: SimpleChatSessionRegistry;
	owner: SimpleChatOwner;
};

class SimpleChatCore extends ChatCore {
	constructor(
		options: ChatCoreOptions,
		private readonly awaitingChanged: () => void
	) {
		super(options);
	}

	override setAwaitingStream(awaiting: boolean): void {
		super.setAwaitingStream(awaiting);
		this.awaitingChanged();
	}
}

export class SimpleChatSession {
	readonly api = SIMPLE_CHAT_API;
	readonly core: ChatCore;
	activeMounts = $state(0);

	// Component-local contexts. Their count is mirrored through activeMounts for registry rendering.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private readonly contexts = new Set<ChatUIContext>();

	constructor(
		readonly threadId: string,
		readonly sessionEpoch: number,
		private readonly draftManager: ChatDraftManager,
		private readonly sendOwner: ComposerSendCoordinator,
		private readonly releaseIfIdle: (session: SimpleChatSession) => void
	) {
		this.core = new SimpleChatCore({ threadId, api: this.api }, () => this.releaseIfIdle(this));
	}

	get isLocked(): boolean {
		return this.core.isSending || this.core.isAwaitingStream;
	}

	attach(context: ChatUIContext): void {
		this.contexts.add(context);
		this.activeMounts = this.contexts.size;
		if (!isChatSessionCurrent(this.sessionEpoch)) {
			this.core.forgetChatSession();
			this.setContextInput(context, '');
			return;
		}
		this.setContextInput(context, this.sendOwner.draftFor(this.threadId));
	}

	projectInput(context: ChatUIContext, projection: ChatInputProjection): void {
		if (
			projection.sessionEpoch !== this.sessionEpoch ||
			projection.origin.threadId !== this.threadId ||
			!isChatSessionCurrent(this.sessionEpoch) ||
			!this.contexts.has(context)
		) {
			return;
		}

		// The cleared text stays stored: the pending send owns it until it settles.
		if (projection.reason === 'send-clear') {
			this.setOtherContextInputs(context, '');
			return;
		}

		// An edit, or work the send owner put back after a refusal: either way the
		// composer's text now, mirrored to every peer showing this thread.
		this.draftManager.setDraft(this.threadId, projection.value);
		this.setOtherContextInputs(context, projection.value);
	}

	/** Compatibility helper for direct session tests and non-component consumers. */
	recordInput(context: ChatUIContext, value: string): void {
		this.projectInput(context, {
			value,
			reason: 'user-edit',
			sessionEpoch: this.sessionEpoch,
			origin: { generation: context.core.threadGeneration, threadId: this.threadId },
			inputRevision: 0
		});
	}

	detach(context: ChatUIContext): void {
		if (!this.contexts.delete(context)) return;
		if (isChatSessionCurrent(this.sessionEpoch)) {
			const value = context.inputValue;
			const keepsSentDraft = value === '' && this.sendOwner.holdsDraft(this.threadId);
			if (!keepsSentDraft && this.draftManager.getDraft(this.threadId) !== value) {
				this.draftManager.setDraft(this.threadId, value);
				this.setAllContextInputs(value);
			}
		}
		this.activeMounts = this.contexts.size;
		this.releaseIfIdle(this);
	}

	async send(client: ConvexClient, prompt: string, context: ChatUIContext): Promise<void> {
		if (!isChatSessionCurrent(this.sessionEpoch)) throw new Error('Chat session ended');
		if (!this.contexts.has(context)) throw new Error('Chat composer is no longer mounted');
		if (this.core.isSending) throw new Error('A message is already being sent');

		try {
			await this.core.sendMessage(client, prompt);
		} finally {
			this.releaseIfIdle(this);
		}
	}

	private setOtherContextInputs(source: ChatUIContext, value: string): void {
		for (const context of this.contexts) {
			if (context !== source) this.setContextInput(context, value);
		}
	}

	private setAllContextInputs(value: string): void {
		for (const context of this.contexts) this.setContextInput(context, value);
	}

	private setContextInput(context: ChatUIContext, value: string): void {
		context.projectInputValue(value);
	}
}

export class SimpleChatSessionRegistry {
	sessions = $state.raw<SimpleChatSession[]>([]);
	owners = $state.raw<SimpleChatOwner[]>([]);
	readonly sessionEpoch = getChatSessionEpoch();

	private invalidated = false;
	private readonly draftManager = new ChatDraftManager('simple-chat');
	/** Shared by every SimpleChat on this client, so a refusal finds whichever composer shows its thread. */
	readonly sendOwner = new ComposerSendCoordinator({ drafts: this.draftManager });

	constructor(
		private readonly removeIfUnused: () => void,
		resetDrafts: boolean
	) {
		if (resetDrafts) this.draftManager.drafts.current = {};
	}

	get isCurrent(): boolean {
		return !this.invalidated && isChatSessionCurrent(this.sessionEpoch);
	}

	retainOwner(): SimpleChatOwner {
		const owner = {};
		this.owners = [...this.owners, owner];
		return owner;
	}

	releaseOwner(owner: SimpleChatOwner): void {
		this.owners = this.owners.filter((candidate) => candidate !== owner);
		if (this.owners.length === 0) {
			this.sessions = this.sessions.filter(
				(session) => session.activeMounts > 0 || session.isLocked
			);
		}
		this.cleanupIfUnused();
	}

	acquire(threadId: string): SimpleChatSession {
		if (!this.isCurrent) {
			this.invalidate();
			throw new Error('SimpleChat registry belongs to an expired chat session');
		}
		let session = this.sessions.find((candidate) => candidate.threadId === threadId);
		if (!session) {
			session = new SimpleChatSession(
				threadId,
				this.sessionEpoch,
				this.draftManager,
				this.sendOwner,
				(candidate) => this.releaseIfIdle(candidate)
			);
			this.sessions = [...this.sessions, session];
		}
		return session;
	}

	retainedSessionsFor(owner: SimpleChatOwner): SimpleChatSession[] {
		if (!this.isCurrent) {
			this.invalidate();
			return [];
		}
		if (this.owners[0] !== owner) return [];
		return this.sessions.filter((session) => session.activeMounts === 0 && session.isLocked);
	}

	releaseIfIdle(session: SimpleChatSession): void {
		if (this.invalidated || session.sessionEpoch !== this.sessionEpoch) return;
		if (session.activeMounts > 0 || session.isLocked) return;
		if (this.sessions.includes(session)) {
			this.sessions = this.sessions.filter((candidate) => candidate !== session);
		}
		this.cleanupIfUnused();
	}

	invalidate(): void {
		if (this.invalidated) return;
		this.invalidated = true;
		this.sessions = [];
		this.owners = [];
		this.removeIfUnused();
	}

	private cleanupIfUnused(): void {
		if (this.owners.length === 0 && this.sessions.length === 0) this.removeIfUnused();
	}
}

export function acquireSimpleChatSessionRegistry(client: ConvexClient): SimpleChatRegistryLease {
	const sessionEpoch = getChatSessionEpoch();
	let registry = clientRegistries.get(client);
	let resetDrafts = false;
	if (registry && registry.sessionEpoch !== sessionEpoch) {
		registry.invalidate();
		registry = undefined;
		resetDrafts = true;
	}
	if (!registry) {
		const created = new SimpleChatSessionRegistry(() => {
			if (clientRegistries.get(client) === created) clientRegistries.delete(client);
		}, resetDrafts);
		registry = created;
		clientRegistries.set(client, registry);
	}
	return { registry, owner: registry.retainOwner() };
}
