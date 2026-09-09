import type { ConvexClient } from 'convex/browser';
import { api } from '$lib/convex/_generated/api';
import { ChatCore, type ChatCoreOptions } from '../core/chat-core.svelte.ts';
import type { ChatDraftManager } from '../core/chat-draft-manager.svelte.ts';
import type { ChatUIContext } from '../ui/chat-context.svelte.ts';

const SIMPLE_CHAT_API = {
	sendMessage: api.aiChat.messages.sendMessage,
	listMessages: api.aiChat.messages.listMessages
};

type IgnoredInput = {
	context: ChatUIContext;
	value: string;
};

class SimpleChatCore extends ChatCore {
	constructor(
		options: ChatCoreOptions,
		private readonly releaseAfterStream: () => void
	) {
		super(options);
	}

	override setAwaitingStream(awaiting: boolean): void {
		super.setAwaitingStream(awaiting);
		if (!awaiting) this.releaseAfterStream();
	}
}

export class SimpleChatSession {
	readonly api = SIMPLE_CHAT_API;
	readonly core: ChatCore;
	activeMounts = $state(0);

	private context: ChatUIContext | null = null;
	private ignoredInput: IgnoredInput | null = null;
	private inputRevision = 0;

	constructor(
		readonly threadId: string,
		private readonly draftManager: ChatDraftManager,
		private readonly releaseIfIdle: (session: SimpleChatSession) => void
	) {
		this.core = new SimpleChatCore({ threadId, api: this.api }, () => this.releaseIfIdle(this));
	}

	get isLocked(): boolean {
		return this.core.isSending || this.core.isAwaitingStream;
	}

	attach(context: ChatUIContext): void {
		this.activeMounts += 1;
		this.context = context;
		this.setContextInput(context, this.isLocked ? '' : this.draftManager.getDraft(this.threadId));
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
			if (!(this.isLocked && value === '') && this.draftManager.getDraft(this.threadId) !== value) {
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
		const checkpoint = this.draftManager.captureCheckpoint(this.threadId);
		const inputRevision = this.inputRevision;
		if (this.context?.inputValue === '') this.ignoreContextInput(this.context, '');

		try {
			await this.core.sendMessage(client, prompt);
			if (this.draftManager.clearDraftIfUnchanged(checkpoint)) {
				const context = this.context;
				if (context && this.inputRevision === inputRevision) this.setContextInput(context, '');
			}
		} catch (error) {
			const context = this.context;
			if (
				context &&
				this.inputRevision === inputRevision &&
				context.inputValue === '' &&
				this.draftManager.getDraft(this.threadId) === checkpoint.value
			) {
				this.setContextInput(context, checkpoint.value);
			}
			throw error;
		} finally {
			this.releaseIfIdle(this);
		}
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

	constructor(private readonly draftManager: ChatDraftManager) {}

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
		if (!this.sessions.includes(session)) return;
		this.sessions = this.sessions.filter((candidate) => candidate !== session);
	}

	dispose(): void {
		this.sessions = [];
	}
}
