export const LEGAL_CONTENT_DATES = {
	privacy: '2026-03-18',
	terms: '2026-03-18',
	impressum: '2026-03-21'
} as const;

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

export function isIsoCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const [, year, month, day] = match;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	return date.toISOString().slice(0, 10) === value;
}

export function formatLegalContentDate(value: string): string {
	if (!isIsoCalendarDate(value)) throw new Error(`Invalid legal content date: ${value}`);
	const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)!;
	return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}
