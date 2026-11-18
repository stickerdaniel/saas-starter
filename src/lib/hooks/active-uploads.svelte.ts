import { Context } from 'runed';
import { SvelteSet } from 'svelte/reactivity';

/** The parts of SvelteKit's `BeforeNavigate` the root layout reads. */
export interface GuardedNavigation {
	from: { url: URL } | null;
	to: { url: URL } | null;
	willUnload?: boolean;
}

/**
 * Whether a navigation would destroy a file that is still transferring.
 *
 * Leaving the document has no `to` at all, so that case is answered first:
 * comparing `to?.url.pathname` against `from` gives the right answer there only
 * by accident, and would flip silently once either side changes.
 */
export function shouldBlockNavigation(nav: GuardedNavigation, hasActiveUploads: boolean): boolean {
	if (!hasActiveUploads) return false;
	// Reload, tab close, external link, a `data-sveltekit-reload` link to this very
	// page: the document goes away, the transfer with it.
	if (!nav.to || nav.willUnload) return true;
	// Same page, different search params (opening the support panel, switching a
	// chat thread): the document survives, so the page-level answer is "not my
	// call". A surface that drops its own upload on such a change owns that.
	if (nav.to.url.pathname === nav.from?.url.pathname) return false;
	return true;
}

/**
 * Stops a link click that would end a running upload while another navigation
 * is still under way.
 *
 * SvelteKit skips `beforeNavigate` for a navigation that starts while another
 * one is in flight, so the root layout's guard never sees such a click. A page
 * that mirrors its own state into the query with `goto` opens that window on
 * every change. The capture listener on the document runs before every handler
 * below it: preventing the click stops the browser, and stopping its
 * propagation keeps SvelteKit's router and the app's own click handlers (such
 * as a link whose handler calls `goto`) from acting on it. Outside that window
 * the click is left to `beforeNavigate`, so nothing is stopped twice.
 *
 * Back and Forward inside the same window stay uncovered: a popstate cannot be
 * cancelled from here.
 */
export function guardLinkClicksDuringNavigation(
	doc: Document,
	read: {
		navigating: () => boolean;
		currentUrl: () => URL;
		uploads: Pick<ActiveUploads, 'any' | 'noteBlocked'>;
	}
): () => void {
	const onClick = (event: MouseEvent) => {
		if (event.defaultPrevented || !read.navigating()) return;
		const current = read.currentUrl();
		const link = followedLink(event, doc.defaultView, current);
		if (!link) return;
		const nav = { from: { url: current }, to: { url: link.url }, willUnload: link.unloads };
		if (!shouldBlockNavigation(nav, read.uploads.any)) return;
		event.preventDefault();
		event.stopPropagation();
		read.uploads.noteBlocked();
	};
	doc.addEventListener('click', onClick, true);
	return () => doc.removeEventListener('click', onClick, true);
}

/**
 * Where a click takes this tab and whether it loads a new document there, or
 * null for the clicks SvelteKit's router also leaves alone: another button or a
 * modifier, another tab or frame, a same-origin download, or a protocol that
 * opens another app. A browser ignores `download` on another origin and
 * navigates there.
 */
function followedLink(
	event: MouseEvent,
	view: Window | null,
	current: URL
): { url: URL; unloads: boolean } | null {
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
		return null;
	}
	// Along the composed path, as SvelteKit's anchor search walks it: at the
	// document a click inside a shadow root is retargeted to its host, and
	// `closest` stops at the shadow boundary, so a link around a host or a link
	// whose label is slotted in would be missed.
	const anchor = event
		.composedPath()
		.find((node): node is Element => node instanceof Element && node.matches('a[href]'));
	if (!anchor) return null;
	const target = anchor.getAttribute('target');
	const topLevel = view !== null && view.parent === view;
	if (target && target !== '_self' && !((target === '_top' || target === '_parent') && topLevel)) {
		return null;
	}
	const url = new URL(anchor.getAttribute('href') ?? '', anchor.baseURI);
	if (url.origin === current.origin && anchor.hasAttribute('download')) return null;
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	return { url, unloads: loadsDocument(anchor, url, current) };
}

/**
 * Whether SvelteKit hands this link to the browser, which loads a new document:
 * another origin, any `target`, `rel="external"`, or `data-sveltekit-reload` on
 * the link or an ancestor. A reload link that only adds a hash to the current
 * URL scrolls instead.
 */
function loadsDocument(anchor: Element, url: URL, current: URL): boolean {
	if (url.origin !== current.origin || anchor.getAttribute('target')) return true;
	if ((anchor.getAttribute('rel') ?? '').split(/\s+/).includes('external')) return true;
	if (!reloadOption(anchor)) return false;
	const [path, hash] = url.href.split('#');
	return path !== current.href.split('#')[0] || hash === undefined;
}

/** The nearest `data-sveltekit-reload`, walked up as SvelteKit walks it, across shadow roots. */
function reloadOption(anchor: Element): boolean {
	const root = anchor.ownerDocument.documentElement;
	for (let el: Element | null = anchor; el && el !== root; el = parentAcrossShadow(el)) {
		const value = el.getAttribute('data-sveltekit-reload');
		if (value !== null) return value === '' || value === 'true';
	}
	return false;
}

function parentAcrossShadow(el: Element): Element | null {
	const parent = el.assignedSlot ?? el.parentNode;
	if (parent instanceof ShadowRoot) return parent.host;
	return parent instanceof Element ? parent : null;
}

/**
 * Where to reload to when a detected deploy should be taken now, or null.
 *
 * The upload answer is part of this one, not a separate hook: a same-page
 * navigation is let through above because it keeps the document, and this
 * would turn that navigation into a full load that does not. Nothing would ask
 * either, because SvelteKit skips the callbacks while a navigation is under
 * way. The stale chunks survive one more click; the file would not.
 *
 * Deferring is cheap here: the navigations that reach this line while a file
 * is going out are the same-page ones, which reuse the loaded route instead of
 * importing a chunk a deploy may have deleted. The vite:preloadError backstop
 * in app.html covers the rest.
 */
export function deployReloadTarget(
	nav: GuardedNavigation,
	deployDetected: boolean,
	hasActiveUploads: boolean
): URL | null {
	if (!deployDetected || nav.willUnload || !nav.to) return null;
	if (hasActiveUploads) return null;
	return nav.to.url;
}

/**
 * Which surfaces have a file in flight, shared via context.
 *
 * A transfer that dies with the document is invisible: the progress bar
 * disappears and the user assumes the file arrived. The root layout has to ask
 * first, and it cannot see into the surfaces that transfer files, so they
 * report here: the page's chat, the support chat, the avatar picker.
 *
 * Instantiated per request in the root layout, never as a module-level
 * singleton, which would leak across SSR requests.
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
	 * Lets the next navigation through without asking.
	 *
	 * For navigations the app starts itself, where stopping would strand the user:
	 * signing out has already destroyed the session, and a checkout redirect
	 * follows an operation that already happened. Call it immediately before
	 * navigating, because the next navigation of any kind consumes it.
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

	/**
	 * Bumped whenever a deploy reload was held back for a file in flight, so the
	 * UI can offer it instead. Offered rather than retried on its own: a finished
	 * upload can leave work that is not saved yet, like a new avatar before Save.
	 */
	heldReloadCount = $state(0);

	/** Whether app.html has to keep the page after a failed chunk import. */
	holdDeployReload(): boolean {
		if (!this.any) return false;
		this.heldReloadCount++;
		return true;
	}
}

export const activeUploadsContext = new Context<ActiveUploads>('active-uploads');
