import { PersistedState } from 'runed';
import {
	DRAFT_STORAGE_PREFIX,
	getChatSessionEpoch,
	isChatSessionCurrent
} from './chat-persisted-state.js';

export type ChatDraftCheckpoint = Readonly<{
	threadId: string | null;
	value: string;
	revision: number;
	sessionEpoch: number;
}>;

type ThreadRevisions = Map<string, number>;
type NamespaceRevisions = Map<string, ThreadRevisions>;

/** Document-local revisions shared by every manager using the same Storage. */
const storageRevisions = new WeakMap<Storage, NamespaceRevisions>();

function getStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * Manages per-thread draft text persistence via localStorage.
 *
 * Each chat surface gets its own manager, so their threads cannot collide.
 */
export class ChatDraftManager {
	readonly drafts: PersistedState<Record<string, string>>;
	private readonly namespace: string;
	private readonly storage: Storage | null;

	/**
	 * @param surface which chat this belongs to, e.g. `ai-chat`. The namespace
	 * is added here so no caller can spell it differently, which is what lets
	 * `clearPersistedChatState` find every surface.
	 */
	constructor(surface: string) {
		this.namespace = `${DRAFT_STORAGE_PREFIX}${surface}`;
		this.storage = getStorage();
		this.drafts = new PersistedState<Record<string, string>>(this.namespace, {});
	}

	getDraft(threadId: string | null): string {
		return threadId ? (this.drafts.current[threadId] ?? '') : '';
	}

	captureCheckpoint(threadId: string | null): ChatDraftCheckpoint {
		return {
			threadId,
			value: this.getDraft(threadId),
			revision: this.revision(threadId),
			sessionEpoch: getChatSessionEpoch()
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
			!isChatSessionCurrent(checkpoint.sessionEpoch) ||
			this.revision(threadId) !== expectedRevision ||
			this.getDraft(threadId) !== checkpoint.value
		) {
			return false;
		}
		this.clearDraft(threadId);
		return true;
	}

	private revision(threadId: string | null): number {
		return this.threadRevisions()?.get(threadId ?? '') ?? 0;
	}

	private advance(threadId: string | null): void {
		const revisions = this.threadRevisions();
		if (!revisions) return;
		const key = threadId ?? '';
		revisions.set(key, (revisions.get(key) ?? 0) + 1);
	}

	private threadRevisions(): ThreadRevisions | null {
		if (!this.storage) return null;
		let namespaces = storageRevisions.get(this.storage);
		if (!namespaces) {
			// Document-local bookkeeping that never participates in rendering.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			namespaces = new Map();
			storageRevisions.set(this.storage, namespaces);
		}
		let revisions = namespaces.get(this.namespace);
		if (!revisions) {
			// Document-local bookkeeping that never participates in rendering.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			revisions = new Map();
			namespaces.set(this.namespace, revisions);
		}
		return revisions;
	}
}
