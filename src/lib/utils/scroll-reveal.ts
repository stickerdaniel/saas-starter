import type { Action } from 'svelte/action';

/**
 * Reveal an element with the enter-blur-up animation the first time it
 * scrolls into view. Runs only with JS and skips elements already inside
 * the initial viewport, so prerendered marketing content stays visible for
 * crawlers, noscript, and above-the-fold paint. Both utility classes are
 * reduced-motion-safe (see layout.css).
 */
export const scrollReveal: Action<HTMLElement, { delay?: number } | undefined> = (
	node,
	options
) => {
	if (typeof IntersectionObserver === 'undefined') return;
	if (node.getBoundingClientRect().top < window.innerHeight) return;

	if (options?.delay) {
		node.style.setProperty('--enter-delay', `${options.delay}ms`);
	}
	node.classList.add('enter-blur-up-wait');

	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			observer.disconnect();
			node.classList.remove('enter-blur-up-wait');
			node.classList.add('animate-enter-blur-up');
		},
		// The huge top margin keeps elements ABOVE the viewport intersecting, so
		// an instant jump past a section (End key, anchor link) still reveals
		// it; the observer only fires on status changes, and a single-frame jump
		// from below to above the viewport never changes plain intersection.
		{ rootMargin: '9999px 0px -10% 0px' }
	);
	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		}
	};
};
