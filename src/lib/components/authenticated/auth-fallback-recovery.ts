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
