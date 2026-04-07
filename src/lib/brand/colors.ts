/**
 * Cadenza brand color tokens.
 *
 * Single source of truth. Imported by brand pages, component primitives,
 * and `src/routes/layout.css` via the scoped `.brand-page` override.
 */

export interface BrandColor {
	token: `--brand-${string}`;
	name: string;
	hex: `#${string}`;
	oklch: string;
	role: string;
}

export const BRAND_COLORS: readonly BrandColor[] = [
	{
		token: '--brand-ink',
		name: 'Ink',
		hex: '#1A1A1A',
		oklch: 'oklch(0.18 0.005 270)',
		role: 'Primary text, authority, the soloist'
	},
	{
		token: '--brand-terracotta',
		name: 'Terracotta',
		hex: '#C75B39',
		oklch: 'oklch(0.58 0.15 38)',
		role: 'The brand. Used sparingly. The cadenza moment.'
	},
	{
		token: '--brand-amber',
		name: 'Amber',
		hex: '#D4913A',
		oklch: 'oklch(0.71 0.13 70)',
		role: 'Secondary accent, warmth, optimism'
	},
	{
		token: '--brand-cream',
		name: 'Cream',
		hex: '#F5CEB8',
		oklch: 'oklch(0.88 0.05 60)',
		role: 'Highlights, soft surfaces'
	},
	{
		token: '--brand-warm-white',
		name: 'Warm White',
		hex: '#FAF7F4',
		oklch: 'oklch(0.97 0.008 75)',
		role: 'Background, breathing room'
	}
] as const;

export const BRAND_COLOR_USAGE_RULES: readonly string[] = [
	'Ink and Warm White carry 90% of every page.',
	'Terracotta is the punctuation. If a screen has more than two terracotta elements, one of them is wrong.',
	'Amber and Cream support Terracotta — never compete with it.',
	'Every text/background pair must hit WCAG AA at minimum. Ink-on-Warm-White and Warm-White-on-Ink both pass AAA.'
] as const;
