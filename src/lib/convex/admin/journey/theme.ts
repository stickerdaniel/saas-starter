import type { RailTheme } from '../../emails/journeyTimeline';

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
