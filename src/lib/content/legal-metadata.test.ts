import { describe, expect, it } from 'vitest';
import { formatLegalContentDate, isIsoCalendarDate } from './legal-metadata';

describe('legal content dates', () => {
	it.each([
		['2026-03-18', 'March 18, 2026'],
		['2024-02-29', 'February 29, 2024']
	])('formats the calendar date %s', (value, expected) => {
		expect(isIsoCalendarDate(value)).toBe(true);
		expect(formatLegalContentDate(value)).toBe(expected);
	});

	it.each(['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-01'])(
		'rejects %s',
		(value) => {
			expect(isIsoCalendarDate(value)).toBe(false);
			expect(() => formatLegalContentDate(value)).toThrow(/Invalid legal content date/);
		}
	);
});
