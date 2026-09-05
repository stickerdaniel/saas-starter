/**
 * Circular reveal wiring for the theme toggle.
 *
 * The button lives in the component; the transition lives here because the
 * ordering it depends on is invisible in markup. The reveal origin is only
 * valid once the view-transition pseudo-elements exist, the root marker
 * outlives the transition that set it whenever a second toggle starts
 * mid-animation, and all three transition promises reject together when the
 * theme update throws.
 */

/** Scopes the circular reveal in `layout.css` to the toggle, not to navigation. */
const MARKER = 'data-theme-transition';

/**
 * Source of the per-transition token. Overlapping toggles must not clear each
 * other's marker, and a document-scoped counter cannot collide the way a
 * timestamp can.
 */
let revealCount = 0;

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

	revealCount += 1;
	const mark = String(revealCount);
	root.setAttribute(MARKER, mark);

	/** Clear the marker only while it still carries this transition's token. */
	const releaseMark = () => {
		if (root.getAttribute(MARKER) === mark) root.removeAttribute(MARKER);
	};

	const transition = document.startViewTransition(applyTheme);

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
