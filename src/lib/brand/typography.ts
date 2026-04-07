/**
 * Cadenza brand typography tokens.
 *
 * Two families: Fraunces (the voice) and Geist Sans (the room).
 * Source of truth for specimens, the resources page, and scoped @theme vars.
 */

export interface BrandFont {
	name: 'Fraunces' | 'Geist Sans';
	role: 'voice' | 'room';
	description: string;
	weights: readonly number[];
	italic: boolean;
	usage: readonly string[];
	avoid: readonly string[];
}

export const FONTS: readonly BrandFont[] = [
	{
		name: 'Fraunces',
		role: 'voice',
		description:
			'The voice. Serif, italic, expressive. Used for display, hero headlines, the wordmark, pull quotes.',
		weights: [400, 700],
		italic: true,
		usage: [
			'Display headlines',
			'The Cadenza wordmark',
			'Pull quotes',
			'Long-form editorial openers'
		],
		avoid: ['Body copy', 'UI controls', 'Buttons', 'Form labels']
	},
	{
		name: 'Geist Sans',
		role: 'room',
		description:
			'The room. Neutral, functional, quiet. Used for body, UI, navigation, buttons, forms, everything else.',
		weights: [400, 500, 600],
		italic: false,
		usage: ['Body copy', 'UI controls', 'Navigation', 'Buttons', 'Forms', 'Errors', 'Metadata'],
		avoid: ['The wordmark', 'Brand display moments', 'Pull quotes']
	}
] as const;

export interface TypeScaleToken {
	token: string;
	px: number;
	font: 'Fraunces italic 400' | 'Geist 400' | 'Geist 500' | 'Geist 600';
	use: string;
}

export const TYPE_SCALE: readonly TypeScaleToken[] = [
	{ token: 'text-display', px: 64, font: 'Fraunces italic 400', use: 'Hero headlines only' },
	{ token: 'text-h1', px: 48, font: 'Fraunces italic 400', use: 'Page titles' },
	{ token: 'text-h2', px: 32, font: 'Geist 600', use: 'Section headings' },
	{ token: 'text-h3', px: 24, font: 'Geist 600', use: 'Sub-sections' },
	{ token: 'text-body-lg', px: 18, font: 'Geist 400', use: 'Lead paragraphs' },
	{ token: 'text-body', px: 16, font: 'Geist 400', use: 'Default body' },
	{ token: 'text-small', px: 14, font: 'Geist 400', use: 'Captions, metadata' },
	{ token: 'text-micro', px: 12, font: 'Geist 500', use: 'Labels, eyebrows' }
] as const;

export const TYPE_RULES: readonly string[] = [
	'Fraunces never appears in body copy.',
	'Geist never appears in the wordmark.',
	'If you find yourself reaching for one in the other’s territory, the design is wrong.'
] as const;
