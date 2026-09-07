import { PersistedState } from 'runed';
import { DRAFT_STORAGE_PREFIX } from './chat-persisted-state.js';

export type ChatDraftCheckpoint = Readonly<{
	threadId: string | null;
	value: string;
	revision: number;
}>;

/**
 * Manages per-thread draft text persistence via localStorage.
 *
 * Each chat surface gets its own manager, so their threads cannot collide.
 */
export class ChatDraftManager {
	readonly drafts: PersistedState<Record<string, string>>;
	// Instance-local because each manager already owns one persisted namespace.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private readonly revisions = new Map<string, number>();

	/**
	 * @param surface which chat this belongs to, e.g. `ai-chat`. The namespace
	 * is added here so no caller can spell it differently, which is what lets
	 * `clearPersistedChatState` find every surface.
	 */
	constructor(surface: string) {
		this.drafts = new PersistedState<Record<string, string>>(
			`${DRAFT_STORAGE_PREFIX}${surface}`,
			{}
		);
	}

	getDraft(threadId: string | null): string {
		return threadId ? (this.drafts.current[threadId] ?? '') : '';
	}

	captureCheckpoint(threadId: string | null): ChatDraftCheckpoint {
		return {
			threadId,
			value: this.getDraft(threadId),
			revision: this.revision(threadId)
		};
	}

	setDraft(threadId: string | null, text: string): void {
		this.advance(threadId);
		if (!threadId) return;
		if (text.trim()) {
			this.drafts.current[threadId] = text;
		} else {
			// Rest spread instead of delete: PersistedState's Proxy has no deleteProperty trap,
			// so `delete` silently skips localStorage serialization
			const { [threadId]: _, ...rest } = this.drafts.current;
			this.drafts.current = rest;
		}
	}

	clearDraft(threadId: string | null): void {
		this.advance(threadId);
		if (!threadId) return;
		const { [threadId]: _, ...rest } = this.drafts.current;
		this.drafts.current = rest;
	}

	clearDraftIfUnchanged(
		checkpoint: ChatDraftCheckpoint,
		threadId: string | null = checkpoint.threadId
	): boolean {
		const expectedRevision = threadId === checkpoint.threadId ? checkpoint.revision : 0;
		if (
			this.revision(threadId) !== expectedRevision ||
			this.getDraft(threadId) !== checkpoint.value
		) {
			return false;
		}
		this.clearDraft(threadId);
		return true;
	}

	private revision(threadId: string | null): number {
		return this.revisions.get(threadId ?? '') ?? 0;
	}

	private advance(threadId: string | null): void {
		const key = threadId ?? '';
		this.revisions.set(key, this.revision(threadId) + 1);
	}
}
