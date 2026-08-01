/**
 * The chat state that outlives a document, and how to get rid of it.
 *
 * Two namespaces in `localStorage`, one per kind, with the surface as the
 * suffix (`drafts:ai-chat`, `attachments:support`). `ChatDraftManager` and
 * `ChatAttachmentStore` build their keys from these, so the sweep below matches
 * every surface, including ones added after it was written.
 */

export const DRAFT_STORAGE_PREFIX = 'drafts:';
export const ATTACHMENT_STORAGE_PREFIX = 'attachments:';

const PREFIXES = [DRAFT_STORAGE_PREFIX, ATTACHMENT_STORAGE_PREFIX];

/**
 * Drop every draft and every stored attachment.
 *
 * Called where one person's session ends and another's begins. Both hold what
 * the user wrote and did not send, and a stored attachment carries a URL that
 * serves the file to anyone holding it, so neither may greet whoever signs in
 * next on the same browser.
 *
 * Never throws: this runs on the way out of a session, and storage that is
 * unavailable (private mode, a full quota) must not be able to strand someone
 * on a page they have already signed out of.
 */
export function clearPersistedChatState(): void {
	try {
		if (typeof localStorage === 'undefined') return;
		// Collected first, emptied after: writing during the walk is fine, but
		// this keeps the two halves separate and the loop honest about its bounds.
		const doomed: string[] = [];
		for (let index = 0; index < localStorage.length; index++) {
			const key = localStorage.key(index);
			if (key && PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
		}
		// Emptied rather than removed. Runed's PersistedState answers a read from
		// the value it started with once the key is absent, and ignores a storage
		// event that reports a deletion, so a store still alive anywhere (the
		// support widget outlives the route the user signed out from, and other
		// tabs outlive the document) would write the previous session's content
		// back on its next save. An empty object is a value it accepts and adopts.
		for (const key of doomed) localStorage.setItem(key, '{}');
	} catch (error) {
		console.error('[chat] Could not clear persisted chat state:', error);
	}
}
