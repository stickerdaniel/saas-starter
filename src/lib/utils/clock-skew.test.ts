import { describe, it, expect } from 'vitest';
import { computeSkewMs, isClockSkewed, formatSkewMagnitude, SKEW_THRESHOLD_MS } from './clock-skew';

describe('computeSkewMs', () => {
	it('returns ~0 for a synced clock, correcting for latency', () => {
		// 200ms round trip; server time captured at the midpoint
		expect(computeSkewMs(1000, 1200, 1100)).toBe(0);
	});

	it('detects a fast client clock as positive', () => {
		const sixHours = 6 * 3_600_000;
		expect(computeSkewMs(sixHours + 1000, sixHours + 1200, 1100)).toBe(sixHours);
	});

	it('detects a slow client clock as negative', () => {
		expect(computeSkewMs(1000, 1200, 1100 + 600_000)).toBe(-600_000);
	});
});

describe('isClockSkewed', () => {
	it('is false before a measurement exists', () => {
		expect(isClockSkewed(null)).toBe(false);
	});

	it('is false within the threshold', () => {
		expect(isClockSkewed(SKEW_THRESHOLD_MS - 1)).toBe(false);
		expect(isClockSkewed(-(SKEW_THRESHOLD_MS - 1))).toBe(false);
	});

	it('is true at or past the threshold in either direction', () => {
		expect(isClockSkewed(SKEW_THRESHOLD_MS)).toBe(true);
		expect(isClockSkewed(-SKEW_THRESHOLD_MS)).toBe(true);
	});
});

describe('formatSkewMagnitude', () => {
	it('formats hours, minutes, and seconds', () => {
		expect(formatSkewMagnitude(6 * 3_600_000)).toBe('6 h');
		expect(formatSkewMagnitude(12 * 60_000)).toBe('12 min');
		expect(formatSkewMagnitude(45_000)).toBe('45 s');
	});

	it('is empty when unmeasured and ignores direction', () => {
		expect(formatSkewMagnitude(null)).toBe('');
		expect(formatSkewMagnitude(-6 * 3_600_000)).toBe('6 h');
	});
});
