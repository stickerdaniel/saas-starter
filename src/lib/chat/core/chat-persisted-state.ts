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

/** A composer that is on screen right now and holds more than storage does. */
export interface PersistedChatHolder {
	/** Let go of everything belonging to the session that is ending. */
	forgetPersistedState(): void;
}

/**
 * The composers currently mounted.
 *
 * Structural, and registered by the holder itself, so this module stays free of
 * anything it would otherwise have to import back.
 */
const holders = new Set<PersistedChatHolder>();

/**
 * The one key here that is not a composer: word that a session has ended.
 *
 * A storage event only ever reaches other documents, which is exactly the reach
 * the register does not have, since it knows the composers of its own page.
 * Neither half covers the other, so both are here.
 */
const SESSION_END_KEY = 'chat:session-ended';

let listening = false;

/** Start hearing about sessions that ended in another tab. Runs once. */
function listenForSessionEnd(): void {
	if (listening || typeof window === 'undefined') return;
	listening = true;
	window.addEventListener('storage', (event) => {
		if (event.key !== SESSION_END_KEY || event.newValue === null) return;
		forgetEverything();
	});
}

/** Ask every mounted composer to let go, tolerating one that will not. */
function forgetEverything(): void {
	for (const holder of holders) {
		try {
			holder.forgetPersistedState();
		} catch (error) {
			console.error('[chat] A composer would not let go of its state:', error);
		}
	}
}

/** Announce a composer, and take it back when it goes. */
export function registerPersistedChatHolder(holder: PersistedChatHolder): () => void {
	listenForSessionEnd();
	holders.add(holder);
	return () => holders.delete(holder);
}

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
	// The composers on screen first, because storage is not where they keep it.
	// One survives every sign-out: the support widget belongs to the shell, so
	// it is still mounted on the page the user lands on afterwards, holding what
	// the last person attached and about to save it again.
	forgetEverything();
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
		// Word to the other tabs, whose composers this page cannot reach and
		// which would otherwise save the ended session back over what was just
		// emptied. A value that never repeats, because a storage event only
		// fires when one actually changes.
		localStorage.setItem(SESSION_END_KEY, `${Date.now()}-${Math.random()}`);
	} catch (error) {
		console.error('[chat] Could not clear persisted chat state:', error);
	}
}
