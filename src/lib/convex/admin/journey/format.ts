import { t, type SupportedLocale } from '../../i18n/translations';

/**
 * Locale and time-zone formatting for customer journeys. Presenters and the
 * rail renderer share these, so a time, a duration or a count reads the same
 * in a step, a tile and a coverage note.
 */

/** The recipient's locale and the zone every time is shown in. */
export type JourneyFormat = { locale: SupportedLocale; timeZone: string };

const MINUTE_MS = 60 * 1000;

/**
 * Times inside a journey. A time on the same local day as `relativeTo` is
 * shown as the time alone; otherwise the date comes first.
 */
export type Clock = {
	time(at: number, relativeTo?: number): string;
	date(at: number): string;
};

export function createClock({ locale, timeZone }: JourneyFormat): Clock {
	// Date and time are formatted apart and joined with a comma, because a combined
	// pattern inserts a locale word ("Oct 3 at 18:22") on some ICU versions.
	const dateOnly = new Intl.DateTimeFormat(locale, {
		timeZone,
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	});
	const timeOnly = new Intl.DateTimeFormat(locale, {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	// The calendar day in the zone, independent of the display locale.
	const dayKey = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	return {
		time(at, relativeTo) {
			const time = timeOnly.format(new Date(at));
			const sameDay =
				relativeTo !== undefined &&
				dayKey.format(new Date(relativeTo)) === dayKey.format(new Date(at));
			return sameDay ? time : `${dateOnly.format(new Date(at))}, ${time}`;
		},
		date: (at) => dateOnly.format(new Date(at))
	};
}

/** "14 min", "3 h 5 min", "2 d 5 h": whole units of an epoch difference. */
export function formatDuration(ms: number, locale: SupportedLocale): string {
	const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
	if (minutes < 1) return t(locale, 'email.customer_journey.core.duration.under_minute');
	if (minutes < 60) return t(locale, 'email.customer_journey.core.duration.minutes', { minutes });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const rest = minutes % 60;
		return rest > 0
			? t(locale, 'email.customer_journey.core.duration.hours_minutes', { hours, minutes: rest })
			: t(locale, 'email.customer_journey.core.duration.hours', { hours });
	}
	const days = Math.floor(hours / 24);
	const rest = hours % 24;
	if (days === 1) {
		return rest > 0
			? t(locale, 'email.customer_journey.core.duration.one_day_hours', { hours: rest })
			: t(locale, 'email.customer_journey.core.duration.one_day');
	}
	return rest > 0
		? t(locale, 'email.customer_journey.core.duration.days_hours', { days, hours: rest })
		: t(locale, 'email.customer_journey.core.duration.days', { days });
}

/**
 * A count, or "at least N" when the read behind it was cut short, and "none
 * found in the checked records" for a cut-short read that found nothing.
 * `leading` capitalizes "at least" for the start of a sentence.
 */
export function formatCount(
	count: number,
	lowerBound: boolean,
	locale: SupportedLocale,
	leading = false
): string {
	const formatted = new Intl.NumberFormat(locale).format(count);
	if (!lowerBound) return formatted;
	if (count === 0) return t(locale, 'email.customer_journey.core.count.none_checked');
	return t(
		locale,
		leading
			? 'email.customer_journey.core.count.at_least_leading'
			: 'email.customer_journey.core.count.at_least',
		{ count: formatted }
	);
}

/** An IANA zone name the runtime knows, or UTC for anything else. */
export function resolveTimeZone(value: string | undefined): string {
	if (!value) return 'UTC';
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
	} catch {
		return 'UTC';
	}
}
