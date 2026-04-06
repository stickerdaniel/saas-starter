import { describe, expect, it } from 'vitest';
import { clamp01, lerp } from './loading-bar-motion';

describe('loading-bar motion helpers', () => {
	it('lerp interpolates between two values', () => {
		expect(lerp(0, 100, 0)).toBe(0);
		expect(lerp(0, 100, 0.5)).toBe(50);
		expect(lerp(0, 100, 1)).toBe(100);
	});

	it('clamp01 clamps values to [0, 1]', () => {
		expect(clamp01(-0.5)).toBe(0);
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(1.5)).toBe(1);
	});
});
