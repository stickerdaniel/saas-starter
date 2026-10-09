import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, t } from '../../i18n/translations';
import { createClock, formatCount, formatDuration, resolveTimeZone } from './format';
import { DEFAULT_BOUNDS } from './source';

describe('journey formatting', () => {
	// Sources use these phrases as tile values, and the core rejects a tile value
	// over the bound, so a phrase that outgrows it would blank a valid tile.
	it.each(SUPPORTED_LOCALES)(
		'keeps every core tile value within the default bound in %s',
		(locale) => {
			const largest = Number.MAX_SAFE_INTEGER;
			const values = [
				formatCount(largest, false, locale),
				formatCount(largest, true, locale),
				formatCount(largest, true, locale, true),
				formatCount(0, true, locale),
				t(locale, 'email.customer_journey.core.value.unavailable'),
				t(locale, 'email.customer_journey.core.value.not_recorded')
			];
			for (const value of values) {
				expect(value.length, value).toBeLessThanOrEqual(DEFAULT_BOUNDS.metricValue);
			}
		}
	);

	// Expectations come from the core keys: apps share these tests but word the
	// keys their own way.
	const count = (key: string, params?: Record<string, string>) =>
		t('en', `email.customer_journey.core.count.${key}`, params);
	const duration = (key: string, params?: Record<string, number>, locale = 'en') =>
		t(locale, `email.customer_journey.core.duration.${key}`, params);

	it('words cut-short counts as minimums and never as zero', () => {
		expect(formatCount(2000, false, 'en')).toBe('2,000');
		expect(formatCount(2000, true, 'en')).toBe(count('at_least', { count: '2,000' }));
		expect(formatCount(2000, true, 'en', true)).toBe(count('at_least_leading', { count: '2,000' }));
		expect(formatCount(0, true, 'en')).toBe(count('none_checked'));
		expect(formatCount(0, false, 'en')).toBe('0');
	});

	it('names whole units of a duration', () => {
		const minute = 60_000;
		const hour = 60 * minute;
		expect(formatDuration(30_000, 'en')).toBe(duration('under_minute'));
		expect(formatDuration(6 * minute, 'en')).toBe(duration('minutes', { minutes: 6 }));
		expect(formatDuration(3 * hour, 'en')).toBe(duration('hours', { hours: 3 }));
		expect(formatDuration(4 * hour + 25 * minute, 'en')).toBe(
			duration('hours_minutes', { hours: 4, minutes: 25 })
		);
		expect(formatDuration(24 * hour + 30 * minute, 'en')).toBe(duration('one_day'));
		expect(formatDuration(25 * hour, 'en')).toBe(duration('one_day_hours', { hours: 1 }));
		expect(formatDuration(72 * hour, 'en')).toBe(duration('days', { days: 3 }));
		expect(formatDuration(53 * hour + 59 * minute, 'en')).toBe(
			duration('days_hours', { days: 2, hours: 5 })
		);
		expect(formatDuration(53 * hour, 'de')).toBe(
			duration('days_hours', { days: 2, hours: 5 }, 'de')
		);
	});

	it('shows the date only when the local day changes in the given zone', () => {
		// 23:30 UTC on Oct 24 is already Oct 25 in Berlin, the night summer time ends.
		const evening = Date.UTC(2026, 9, 24, 23, 30);
		const sameBerlinDay = Date.UTC(2026, 9, 25, 22, 30);
		const berlin = createClock({ locale: 'en', timeZone: 'Europe/Berlin' });
		expect(berlin.time(sameBerlinDay, evening)).toBe('23:30');
		expect(berlin.time(evening)).toBe('Sun, Oct 25, 01:30');

		const utc = createClock({ locale: 'en', timeZone: 'UTC' });
		expect(utc.time(sameBerlinDay, evening)).toBe('Sun, Oct 25, 22:30');
	});

	it('falls back to UTC for an absent or unknown zone', () => {
		expect(resolveTimeZone(undefined)).toBe('UTC');
		expect(resolveTimeZone('')).toBe('UTC');
		expect(resolveTimeZone('Mars/Olympus_Mons')).toBe('UTC');
		expect(resolveTimeZone('Europe/Berlin')).toBe('Europe/Berlin');
	});
});
