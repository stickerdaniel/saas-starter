import { describe, expect, it } from 'vitest';
import { formatDuration } from './format-duration';

// Rebuild the expected string via the same Intl config so the assertions check
// unit selection and rounding, not ICU's exact abbreviation across Node versions.
function expected(value: number, unit: 'second' | 'minute' | 'hour', lang = 'en'): string {
	return new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'short' }).format(value);
}

describe('formatDuration', () => {
	it('renders sub-minute durations in seconds', () => {
		expect(formatDuration(0, 'en')).toBe(expected(0, 'second'));
		expect(formatDuration(45_000, 'en')).toBe(expected(45, 'second'));
	});

	it('renders sub-hour durations in minutes', () => {
		expect(formatDuration(5 * 60_000, 'en')).toBe(expected(5, 'minute'));
	});

	it('renders hour-plus durations in hours', () => {
		expect(formatDuration(3 * 3_600_000, 'en')).toBe(expected(3, 'hour'));
	});

	it('rounds to the nearest whole unit', () => {
		// 90s -> 1.5 min -> rounds to 2 min
		expect(formatDuration(90_000, 'en')).toBe(expected(2, 'minute'));
	});

	it('localizes the unit for non-English locales', () => {
		expect(formatDuration(45_000, 'de')).toBe(expected(45, 'second', 'de'));
		expect(formatDuration(45_000, 'de')).toContain('45');
	});
});
