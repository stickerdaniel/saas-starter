/**
 * Circular reveal wiring for the theme toggle.
 *
 * The button lives in the component; the transition lives here because the
 * ordering it depends on is invisible in markup. The root has to carry the new
 * theme before the update callback returns or the captured snapshot is the old
 * page, the reveal origin is only valid once the view-transition
 * pseudo-elements exist, the root marker outlives the transition that set it
 * whenever a second toggle starts mid-animation, and all three transition
 * promises reject together when the theme update throws.
 */

import { flushSync } from 'svelte';

/** Scopes the circular reveal in `layout.css` to the toggle, not to navigation. */
const MARKER = 'data-theme-transition';

/**
 * Source of the per-transition token, parked on the document under a key that
 * survives module identity. Overlapping toggles must not clear each other's
 * marker, and a counter in module scope restarts at zero whenever the module is
 * evaluated again (HMR, a second copy of the bundle) while the transitions it
 * already numbered are still pending. The restarted count then reissues a token
 * one of them still holds, and that older transition strips the newer reveal's
 * marker on its way out.
 */
const REVEAL_COUNT = Symbol.for('saas-starter.theme-reveal.count');

type RevealCountHost = { [REVEAL_COUNT]?: number };

function nextMark(): string {
	const host = document as Document & RevealCountHost;
	const count = (host[REVEAL_COUNT] ?? 0) + 1;
	host[REVEAL_COUNT] = count;
	return String(count);
}

/**
 * Switch the theme behind a circular reveal centred on `toggle`, falling back to
 * an immediate switch wherever the View Transition API is missing.
 */
export function startThemeReveal(toggle: Element, applyTheme: () => void): void {
	if (typeof document.startViewTransition !== 'function') {
		applyTheme();
		return;
	}

	const root = document.documentElement;
	const rect = toggle.getBoundingClientRect();
	const originX = rect.left + rect.width / 2;
	const originY = rect.top + rect.height / 2;

	const mark = nextMark();
	root.setAttribute(MARKER, mark);

	/** Clear the marker only while it still carries this transition's token. */
	const releaseMark = () => {
		if (root.getAttribute(MARKER) === mark) root.removeAttribute(MARKER);
	};

	const transition = document.startViewTransition(() => {
		applyTheme();
		// mode-watcher writes the root class from a derived that only a Svelte
		// effect reads, so the write is still queued when this callback returns.
		// The browser captures the new snapshot at that moment, which would leave
		// the reveal opening onto the theme it just replaced.
		flushSync();
	});

	transition.ready.then(() => {
		// Written once the pseudo-elements exist, so the circle resolves its
		// viewport pixels against the captured layout and not the pre-snapshot one.
		root.style.setProperty('--view-transition-x', `${originX}px`);
		root.style.setProperty('--view-transition-y', `${originY}px`);
	}, releaseMark);

	transition.finished.then(releaseMark, releaseMark);

	// A theme update that throws reaches the page through this promise alone, so
	// leaving it open both loses the error and raises an unhandled rejection.
	transition.updateCallbackDone.catch((error: unknown) => {
		releaseMark();
		console.error('Theme transition update failed:', error);
	});
}
