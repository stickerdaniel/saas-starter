export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function clamp01(value: number): number {
	return Math.min(Math.max(value, 0), 1);
}
