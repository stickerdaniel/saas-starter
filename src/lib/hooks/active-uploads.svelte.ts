import { Context } from 'runed';
import { SvelteSet } from 'svelte/reactivity';

/** The parts of SvelteKit's `BeforeNavigate` the guard reads. */
export interface GuardedNavigation {
	from: { url: URL } | null;
	to: { url: URL } | null;
}

/**
 * Whether a navigation would destroy a file that is still transferring.
 *
 * Leaving the document has no `to` at all, so that case has to be answered
 * first: comparing `to?.url.pathname` against `from` would give the right
 * answer there only by accident, and would flip silently once either side of
 * the comparison changes.
 */
export function shouldBlockNavigation(nav: GuardedNavigation, hasActiveUploads: boolean): boolean {
	if (!hasActiveUploads) return false;
	// Reload, tab close, external link: the document goes away, the transfer with it.
	if (!nav.to) return true;
	// Same page, different search params (opening the support panel, switching a
	// chat thread): the document survives, so the page-level answer is "not my
	// call". A surface that drops its own upload on such a change owns that.
	if (nav.to.url.pathname === nav.from?.url.pathname) return false;
	return true;
}

/**
 * Which surfaces currently have a file in flight, shared via context.
 *
 * A transfer that dies with the document is invisible: the progress bar simply
 * disappears and the user assumes the file arrived. One shared answer is needed
 * because uploads run in several places at once — the page's chat, the floating
 * support chat, and the avatar picker are separate owners.
 *
 * Instantiated per request in the root layout — never a module-level singleton,
 * which would leak across SSR requests.
 */
export class ActiveUploads {
	// Owner identities rather than a count: a count that misses one release (a
	// surface torn down mid-upload) stays wrong for the rest of the session, and
	// a guard that asks for no reason is worse than no guard at all. Claiming and
	// releasing twice is harmless here.
	readonly #owners = new SvelteSet<object>();
	#suspended = false;

	get any(): boolean {
		return this.#owners.size > 0;
	}

	claim(owner: object): void {
		this.#owners.add(owner);
	}

	release(owner: object): void {
		this.#owners.delete(owner);
	}

	/**
	 * Let the next navigation through without asking.
	 *
	 * For navigations the app itself starts, where stopping would strand the
	 * user: signing out has already destroyed the session, a checkout redirect
	 * follows an operation that already happened. Call it immediately before
	 * navigating — the next navigation of any kind consumes it.
	 */
	suspendOnce(): void {
		this.#suspended = true;
	}

	/** Reads and clears the suspension. The guard calls this once per navigation. */
	consumeSuspension(): boolean {
		const suspended = this.#suspended;
		this.#suspended = false;
		return suspended;
	}

	/**
	 * Bumped whenever a navigation inside the app was stopped, so the UI can
	 * explain why the click did nothing. Leaving the document needs no such
	 * signal: the browser shows its own prompt.
	 */
	blockedCount = $state(0);

	noteBlocked(): void {
		this.blockedCount++;
	}
}

export const activeUploadsContext = new Context<ActiveUploads>('active-uploads');
