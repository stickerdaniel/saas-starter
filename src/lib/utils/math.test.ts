import { describe, expect, it } from 'vitest';
import { clamp, clamp01 } from './math';

describe('math helpers', () => {
	it('clamp bounds a value to [min, max]', () => {
		expect(clamp(-5, 0, 10)).toBe(0);
		expect(clamp(5, 0, 10)).toBe(5);
		expect(clamp(15, 0, 10)).toBe(10);
	});

	it('clamp01 clamps values to [0, 1]', () => {
		expect(clamp01(-0.5)).toBe(0);
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(1.5)).toBe(1);
	});
});
