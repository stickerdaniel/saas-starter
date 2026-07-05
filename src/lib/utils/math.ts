/** Clamp `value` into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Clamp `value` into [0, 1] (motion/progress fractions). */
export function clamp01(value: number): number {
	return clamp(value, 0, 1);
}
