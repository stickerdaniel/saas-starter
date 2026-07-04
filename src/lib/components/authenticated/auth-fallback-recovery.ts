/** Inputs to the connection fallback's stage-2 auto-reload decision. */
export interface AutoReloadState {
	/** Client-side auth believes a session exists (cookies survived). */
	isAuthenticated: boolean;
	/** Device clock is far enough off to break cookie auth on its own. */
	isSkewed: boolean;
	/** An automatic reload already happened this browser session. */
	alreadyReloaded: boolean;
}

/**
 * Whether the auth connection fallback should silently reload once to recover.
 *
 * A reload only helps when the client is actually signed in, so a fresh document
 * load can re-resolve the server session, and the clock is sane, since skew is not
 * fixable by reloading and carries its own actionable message. The already-reloaded
 * flag caps this at a single automatic reload per session so a persistent failure
 * degrades to the manual error state instead of looping.
 */
export function shouldAutoReload(state: AutoReloadState): boolean {
	return state.isAuthenticated && !state.isSkewed && !state.alreadyReloaded;
}

/** sessionStorage key marking that the automatic reload already happened. */
const RELOAD_GUARD_KEY = 'auth-fallback-reloaded';

/**
 * Whether the once-per-session reload guard is set.
 *
 * Storage access can throw (Web Storage disabled, hardened webviews), and the
 * caller runs inside the fallback's timeout callback where an uncaught throw
 * would kill the escalation to the manual error state and strand the user on
 * the spinner. Unreadable storage reports true (treated as already reloaded):
 * without a persistable guard an automatic reload could loop forever.
 */
export function hasReloadGuard(): boolean {
	try {
		return sessionStorage.getItem(RELOAD_GUARD_KEY) !== null;
	} catch {
		return true;
	}
}

/**
 * Persists the reload guard before the automatic reload. Returns false when it
 * cannot be persisted (e.g. Safari private-mode quota, where reads work but
 * writes throw) so the caller skips the reload instead of reloading without a
 * loop guard.
 */
export function armReloadGuard(): boolean {
	try {
		sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
		return true;
	} catch {
		return false;
	}
}
