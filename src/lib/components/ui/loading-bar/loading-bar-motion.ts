export const LOADING_STRIP_WIDTH = 60;
export const LOADING_SWEEP_START = -60;
export const LOADING_SWEEP_END = 100;
export const LOADING_SWEEP_DURATION = 1.35;
export const ENTER_LOADING_MS = 250;
export const EXIT_LOADING_MS = 180;
export const EXIT_ACCELERATION_MS = 450;
export const EXIT_MAX_SPEED_MULTIPLIER = 2.25;

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function clamp01(value: number): number {
	return Math.min(Math.max(value, 0), 1);
}

export function easeOut(t: number): number {
	return 1 - (1 - t) * (1 - t);
}

export function getLoadingLeft(phase: number): number {
	return lerp(LOADING_SWEEP_START, LOADING_SWEEP_END, easeOut(clamp01(phase)));
}

export function getStripGeometry(
	progressWidth: number,
	blend: number,
	phase: number
): {
	left: number;
	width: number;
} {
	return {
		left: lerp(0, getLoadingLeft(phase), clamp01(blend)),
		width: lerp(progressWidth, LOADING_STRIP_WIDTH, clamp01(blend))
	};
}

export function advanceLoopingPhase(phase: number, dt: number): number {
	return (phase + dt / LOADING_SWEEP_DURATION) % 1;
}

export function getExitSpeedMultiplier(elapsedMs: number): number {
	const ramp = clamp01(elapsedMs / EXIT_ACCELERATION_MS);
	return 1 + (EXIT_MAX_SPEED_MULTIPLIER - 1) * ramp * ramp;
}

/** Advance phase with gradual speed ramp during exit blend-back (wraps). */
export function advanceRampedPhase(phase: number, dt: number, elapsedMs: number): number {
	const speed = getExitSpeedMultiplier(elapsedMs);
	return (phase + (dt * speed) / LOADING_SWEEP_DURATION) % 1;
}

/**
 * Find the shimmer phase where the loading strip's right edge aligns
 * with the progress bar's right edge, so entering loading mode doesn't
 * cause a backward sweep.
 */
export function syncPhaseToProgress(progressWidth: number): number {
	const target = clamp01(progressWidth / (LOADING_SWEEP_END - LOADING_SWEEP_START));
	return 1 - Math.sqrt(Math.max(1 - target, 0));
}
