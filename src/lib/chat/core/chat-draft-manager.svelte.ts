import { persisted, type Persisted } from '../../storage/persisted.svelte.ts';
import { DRAFT_STORAGE_PREFIX } from './chat-persisted-state.js';

/**
 * Reads stored drafts without trusting them. Another tab, an older build or a hand
 * edit can leave anything under the key; runed would log the raw text, which is
 * the user's unsent message, and return `undefined`, and the next draft read would
 * throw. Anything that is not a string per thread is dropped, so the composer
 * starts empty for that thread instead.
 */
const draftSerializer = {
	serialize: JSON.stringify,
	deserialize(value: string): Record<string, string> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(value);
		} catch {
			return {};
		}
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
	}
};

/**
 * Manages per-thread draft text persistence via localStorage.
 *
 * Each chat surface gets its own manager, so their threads cannot collide.
 */
export class ChatDraftManager {
	readonly drafts: Persisted<Record<string, string>>;

	/**
	 * @param surface which chat this belongs to, e.g. `ai-chat`. The namespace
	 * is added here so no caller can spell it differently, which is what lets
	 * `clearPersistedChatState` find every surface.
	 */
	constructor(surface: string) {
		this.drafts = persisted<Record<string, string>>(
			`${DRAFT_STORAGE_PREFIX}${surface}`,
			{},
			{
				serializer: draftSerializer
			}
		);
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

	/** Drop every draft of the surface now, without waiting for storage to be swept. */
	clear(): void {
		if (Object.keys(this.drafts.current).length > 0) this.drafts.current = {};
	}

	clearDraft(threadId: string | null): void {
		if (!threadId) return;
		const { [threadId]: _, ...rest } = this.drafts.current;
		this.drafts.current = rest;
	}
}
