import type { RailRole, RailTheme } from '../../emails/journeyTimeline';

/**
 * The template's journey rail colours: zinc lines and dots, blue for the
 * payment and the gap labels, red for problems and the cancellation. Light
 * values are the Tailwind colours the email renderer resolves; each dark class
 * is the one it generates for the matching `dark:` utility, so an email that
 * embeds the rail must use those utilities for their styles to exist.
 */
export const JOURNEY_RAIL_THEME = {
	tones: {
		neutral: { dot: { color: '#9f9fa9', darkClass: 'dark_bg-zinc-500' }, title: null }, // zinc-400
		paid: {
			dot: { color: '#155dfc' }, // blue-600 in both schemes
			title: { color: '#1447e6', darkClass: 'dark_text-blue-300' } // blue-700
		},
		problem: { dot: { color: '#e7000b' }, title: null }, // red-600 in both schemes
		canceled: {
			dot: { color: '#e7000b' },
			title: { color: '#c10007', darkClass: 'dark_text-red-400' } // red-700
		}
	},
	line: { color: '#e4e4e7', darkClass: 'dark_bg-zinc-700' }, // zinc-200
	muted: { color: '#71717b', darkClass: 'dark_text-zinc-400' }, // muted-foreground
	gap: { color: '#1447e6', darkClass: 'dark_text-blue-300' } // blue-700
} as const satisfies RailTheme;

/** The colours of the summary tiles above the rail. */
export type TileTheme = Record<'border' | 'label', RailRole>;

/** A zinc border and the rail's muted labels. */
export const JOURNEY_TILE_THEME = {
	border: { color: '#e4e4e7', darkClass: 'dark_border-zinc-800' }, // border
	label: JOURNEY_RAIL_THEME.muted
} as const satisfies TileTheme;

const TONES: RailTheme['tones'] = JOURNEY_RAIL_THEME.tones;

const ROLES: readonly RailRole[] = [
	...Object.values(TONES).flatMap((tone) => (tone.title ? [tone.dot, tone.title] : [tone.dot])),
	JOURNEY_RAIL_THEME.line,
	JOURNEY_RAIL_THEME.muted,
	JOURNEY_RAIL_THEME.gap,
	...Object.values(JOURNEY_TILE_THEME)
];

/**
 * The `dark:` utility behind every dark class above. An email template that
 * embeds the rail or the tiles puts these on a hidden element, because the
 * renderer generates a dark rule only for a utility the template itself uses.
 */
export const JOURNEY_DARK_UTILITIES = [
	...new Set(
		ROLES.flatMap((role) => (role.darkClass ? [role.darkClass.replace(/^dark_/, 'dark:')] : []))
	)
];
