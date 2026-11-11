import { describe, expect, it } from 'vitest';
import { clamp01 } from './math';

describe('math helpers', () => {
	it('clamp01 clamps values to [0, 1]', () => {
		expect(clamp01(-0.5)).toBe(0);
		expect(clamp01(0.5)).toBe(0.5);
		expect(clamp01(1.5)).toBe(1);
	});
});
