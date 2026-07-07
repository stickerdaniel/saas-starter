import { describe, expect, it } from 'vitest';
import { lerp } from './loading-bar-motion';

describe('loading-bar motion helpers', () => {
	it('lerp interpolates between two values', () => {
		expect(lerp(0, 100, 0)).toBe(0);
		expect(lerp(0, 100, 0.5)).toBe(50);
		expect(lerp(0, 100, 1)).toBe(100);
	});
});
