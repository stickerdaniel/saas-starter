import { describe, expect, it } from 'vitest';
import {
	LOADING_STRIP_WIDTH,
	LOADING_SWEEP_END,
	LOADING_SWEEP_START,
	advanceLoopingPhase,
	advanceRampedPhase,
	getLoadingLeft,
	getStripGeometry,
	syncPhaseToProgress
} from './loading-bar-motion';

describe('loading-bar motion helpers', () => {
	it('maps the single loading strip across the full sweep', () => {
		expect(getLoadingLeft(0)).toBe(LOADING_SWEEP_START);
		expect(getLoadingLeft(1)).toBe(LOADING_SWEEP_END);
		expect(getLoadingLeft(0.5)).toBeGreaterThan(getLoadingLeft(0.25));
	});

	it('looping phase wraps, ramped phase also wraps', () => {
		expect(advanceLoopingPhase(0.98, 0.1)).toBeLessThan(0.98);
		// Ramped phase wraps too (unlike the old advanceExitPhase which clamped)
		expect(advanceRampedPhase(0.98, 0.5, 500)).toBeLessThan(0.98);
		expect(advanceRampedPhase(0.4, 0.05, 0)).toBeGreaterThan(0.4);
	});

	it('blends between determinate progress and the loading sweep with one strip', () => {
		expect(getStripGeometry(33, 0, 0.6)).toEqual({ left: 0, width: 33 });
		expect(getStripGeometry(33, 1, 1)).toEqual({
			left: LOADING_SWEEP_END,
			width: LOADING_STRIP_WIDTH
		});
	});

	it('syncPhaseToProgress aligns strip right edge with progress right edge', () => {
		// At 0% progress, phase should be 0 (strip starts offscreen left)
		expect(syncPhaseToProgress(0)).toBe(0);
		// At higher progress, phase should be > 0
		expect(syncPhaseToProgress(50)).toBeGreaterThan(0);
		expect(syncPhaseToProgress(100)).toBeGreaterThan(syncPhaseToProgress(50));
		// Phase should always be in [0, 1)
		expect(syncPhaseToProgress(160)).toBeLessThanOrEqual(1);
	});
});
