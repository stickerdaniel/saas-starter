/**
 * Format an elapsed duration (in milliseconds) into a localized, human-readable
 * string like "45 sec", "5 min", or "3 hr". Picks the largest unit that keeps
 * the number readable: seconds under a minute, minutes under an hour, else
 * hours, and rounds to a whole unit. Intl.NumberFormat localizes the unit
 * itself, so no translation keys are needed. A falsy `lang` falls back to the
 * runtime default locale.
 */
export function formatDuration(ms: number, lang: string): string {
	const seconds = ms / 1000;
	let value: number;
	let unit: 'second' | 'minute' | 'hour';

	if (seconds < 60) {
		value = Math.round(seconds);
		unit = 'second';
	} else if (seconds < 3600) {
		value = Math.round(seconds / 60);
		unit = 'minute';
	} else {
		value = Math.round(seconds / 3600);
		unit = 'hour';
	}

	return new Intl.NumberFormat(lang || undefined, {
		style: 'unit',
		unit,
		unitDisplay: 'short'
	}).format(value);
}
