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

export function formatLegalContentDate(value: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) throw new Error(`Invalid legal content date: ${value}`);
	const [, year, month, day] = match;
	const monthName = MONTHS[Number(month) - 1];
	if (!monthName || Number(day) < 1 || Number(day) > 31) {
		throw new Error(`Invalid legal content date: ${value}`);
	}
	return `${monthName} ${Number(day)}, ${year}`;
}
