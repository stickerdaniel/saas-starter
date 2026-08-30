/**
 * Read one of the `t-*` recipe's motion tokens off the document root.
 *
 * The recipes deliberately keep their timings in CSS so a designer can retune
 * them in `layout.css` without touching code. Any JS that has to stay in step
 * with a transition therefore reads the value back rather than repeating it,
 * which is what stops the two copies drifting apart.
 */
export function motionMs(name: string, fallback: number): number {
	if (typeof document === 'undefined') return fallback;
	const value = Number.parseFloat(
		getComputedStyle(document.documentElement).getPropertyValue(name)
	);
	return Number.isFinite(value) ? value : fallback;
}

/** Same, for a token whose value is an easing function rather than a duration. */
export function motionEase(name: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
