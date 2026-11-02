import { tick } from 'svelte';

/**
 * Changes what an auth card shows through the shared-element morph the sign-in and sign-up
 * cards use (`auth-card` in layout.css), so a card that changes height resizes in place
 * instead of jumping. Reduced motion, and browsers without view transitions, swap at once.
 * Both states have to render their card with AuthPanel's `transition`.
 */
export function morphAuthCard(update: () => void): void {
	if (
		typeof document.startViewTransition !== 'function' ||
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	) {
		update();
		return;
	}
	document.startViewTransition(async () => {
		update();
		await tick();
	});
}
