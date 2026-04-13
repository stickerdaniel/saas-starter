import { PersistedState } from 'runed';

/**
 * Manages per-thread draft text persistence via localStorage.
 *
 * Each chat surface instantiates its own manager with a unique storage key
 * to avoid collisions (e.g. 'drafts:ai-chat', 'drafts:admin-support').
 */
export class ChatDraftManager {
	readonly drafts: PersistedState<Record<string, string>>;

	constructor(storageKey: string) {
		this.drafts = new PersistedState<Record<string, string>>(storageKey, {});
	}

	getDraft(threadId: string | null): string {
		return threadId ? (this.drafts.current[threadId] ?? '') : '';
	}

	setDraft(threadId: string | null, text: string): void {
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
		if (!threadId) return;
		const { [threadId]: _, ...rest } = this.drafts.current;
		this.drafts.current = rest;
	}
}
