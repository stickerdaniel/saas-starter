import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import { ChatCore, type ChatCoreOptions } from '../core/chat-core.svelte.ts';
import { ChatDraftManager, type ChatDraftCheckpoint } from '../core/chat-draft-manager.svelte.ts';
import type { ChatUIContext } from '../ui/chat-context.svelte.ts';

const SIMPLE_CHAT_API = {
	sendMessage: api.aiChat.messages.sendMessage,
	listMessages: api.aiChat.messages.listMessages
};

const clientRegistries = new WeakMap<ConvexClient, SimpleChatSessionRegistry>();

type IgnoredInput = {
	context: ChatUIContext;
	value: string;
};

type ActiveSend = {
	checkpoint: ChatDraftCheckpoint;
	inputRevision: number;
	succeeded: boolean;
};

class SimpleChatCore extends ChatCore {
	constructor(
		options: ChatCoreOptions,
		private readonly awaitingChanged: (awaiting: boolean) => void
	) {
		super(options);
	}

	override setAwaitingStream(awaiting: boolean): void {
		super.setAwaitingStream(awaiting);
		this.awaitingChanged(awaiting);
	}
}

export class SimpleChatSession {
	readonly api = SIMPLE_CHAT_API;
	readonly core: ChatCore;
	activeMounts = $state(0);

	private context: ChatUIContext | null = null;
	private ignoredInput: IgnoredInput | null = null;
	private inputRevision = 0;
	private activeSend: ActiveSend | null = null;

	constructor(
		readonly threadId: string,
		private readonly draftManager: ChatDraftManager,
		private readonly releaseIfIdle: (session: SimpleChatSession) => void
	) {
		this.core = new SimpleChatCore({ threadId, api: this.api }, (awaiting) =>
			this.handleAwaitingChange(awaiting)
		);
	}

	get isLocked(): boolean {
		return this.core.isSending || this.core.isAwaitingStream;
	}

	attach(context: ChatUIContext): void {
		this.activeMounts += 1;
		this.context = context;
		const hideSentDraft = this.isLocked && this.activeSend?.inputRevision === this.inputRevision;
		this.setContextInput(context, hideSentDraft ? '' : this.draftManager.getDraft(this.threadId));
	}

	recordInput(context: ChatUIContext, value: string): void {
		if (this.context !== context) return;
		if (this.ignoredInput?.context === context && this.ignoredInput.value === value) {
			this.ignoredInput = null;
			return;
		}
		this.ignoredInput = null;
		this.inputRevision += 1;
		this.draftManager.setDraft(this.threadId, value);
	}

	detach(context: ChatUIContext): void {
		if (this.context === context) {
			const value = context.inputValue;
			const hideSentDraft =
				this.isLocked && this.activeSend?.inputRevision === this.inputRevision && value === '';
			if (!hideSentDraft && this.draftManager.getDraft(this.threadId) !== value) {
				this.inputRevision += 1;
				this.draftManager.setDraft(this.threadId, value);
			}
			this.context = null;
			this.ignoredInput = null;
		}
		this.activeMounts = Math.max(0, this.activeMounts - 1);
		this.releaseIfIdle(this);
	}

	async send(client: ConvexClient, prompt: string): Promise<void> {
		const activeSend: ActiveSend = {
			checkpoint: this.draftManager.captureCheckpoint(this.threadId),
			inputRevision: this.inputRevision,
			succeeded: false
		};
		this.activeSend = activeSend;
		if (this.context?.inputValue === '') this.ignoreContextInput(this.context, '');

		try {
			await this.core.sendMessage(client, prompt);
			activeSend.succeeded = true;
			if (this.draftManager.clearDraftIfUnchanged(activeSend.checkpoint)) {
				const context = this.context;
				if (context && this.inputRevision === activeSend.inputRevision) {
					this.setContextInput(context, '');
				}
			}
			if (!this.core.isAwaitingStream && this.activeSend === activeSend) {
				this.activeSend = null;
			}
		} catch (error) {
			const context = this.context;
			if (
				context &&
				this.inputRevision === activeSend.inputRevision &&
				context.inputValue === '' &&
				this.draftManager.getDraft(this.threadId) === activeSend.checkpoint.value
			) {
				this.setContextInput(context, activeSend.checkpoint.value);
			}
			if (this.activeSend === activeSend) this.activeSend = null;
			throw error;
		} finally {
			this.releaseIfIdle(this);
		}
	}

	private handleAwaitingChange(awaiting: boolean): void {
		if (!awaiting && this.activeSend?.succeeded) this.activeSend = null;
		this.releaseIfIdle(this);
	}

	private setContextInput(context: ChatUIContext, value: string): void {
		this.ignoreContextInput(context, value);
		context.setInputValue(value);
	}

	private ignoreContextInput(context: ChatUIContext, value: string): void {
		this.ignoredInput = { context, value };
	}
}

export class SimpleChatSessionRegistry {
	sessions = $state.raw<SimpleChatSession[]>([]);
	private ownerCount = 0;
	private readonly draftManager = new ChatDraftManager('simple-chat');

	constructor(private readonly removeIfUnused: () => void) {}

	retainOwner(): void {
		this.ownerCount += 1;
	}

	releaseOwner(): void {
		this.ownerCount = Math.max(0, this.ownerCount - 1);
		if (this.ownerCount === 0) {
			this.sessions = this.sessions.filter(
				(session) => session.activeMounts > 0 || session.isLocked
			);
		}
		this.cleanupIfUnused();
	}

	acquire(threadId: string): SimpleChatSession {
		let session = this.sessions.find((candidate) => candidate.threadId === threadId);
		if (!session) {
			session = new SimpleChatSession(threadId, this.draftManager, (candidate) =>
				this.releaseIfIdle(candidate)
			);
			this.sessions = [...this.sessions, session];
		}
		return session;
	}

	get retainedSessions(): SimpleChatSession[] {
		return this.sessions.filter((session) => session.activeMounts === 0 && session.isLocked);
	}

	releaseIfIdle(session: SimpleChatSession): void {
		if (session.activeMounts > 0 || session.isLocked) return;
		if (this.sessions.includes(session)) {
			this.sessions = this.sessions.filter((candidate) => candidate !== session);
		}
		this.cleanupIfUnused();
	}

	private cleanupIfUnused(): void {
		if (this.ownerCount === 0 && this.sessions.length === 0) this.removeIfUnused();
	}
}

export function acquireSimpleChatSessionRegistry(client: ConvexClient): SimpleChatSessionRegistry {
	let registry = clientRegistries.get(client);
	if (!registry) {
		const created = new SimpleChatSessionRegistry(() => {
			if (clientRegistries.get(client) === created) clientRegistries.delete(client);
		});
		registry = created;
		clientRegistries.set(client, registry);
	}
	registry.retainOwner();
	return registry;
}
