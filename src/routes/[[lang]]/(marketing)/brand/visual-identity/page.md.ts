import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Visual Identity',
	description:
		'The Cadenza visual identity — logo, color system, and typography. Fraunces is the voice; Geist Sans is the room; terracotta is the punctuation.',
	sections: [
		{
			heading: 'Logo',
			paragraphs: [
				'The mark is a lowercase italic c in Fraunces, set on an ink → terracotta gradient at 135°. The wordmark is cadenza, lowercase, Fraunces italic.',
				'Clear space equals the height of the mark on all sides. Minimum size 24px tall on screen, 8mm in print. Monochrome variants only: ink on warm white, warm white on ink.'
			]
		},
		{
			heading: 'Color system',
			bullets: [
				'Ink (#1A1A1A) — primary text, authority, the soloist',
				'Terracotta (#C75B39) — the brand. Used sparingly. The cadenza moment.',
				'Amber (#D4913A) — secondary accent, warmth',
				'Cream (#F5CEB8) — highlights, soft surfaces',
				'Warm White (#FAF7F4) — background, breathing room'
			]
		},
		{
			heading: 'Color usage rules',
			bullets: [
				'Ink and Warm White carry 90% of every page',
				'Terracotta is the punctuation. More than two terracotta elements on a screen means one is wrong.',
				'Amber and Cream support Terracotta — never compete with it.',
				'Every text/background pair must hit WCAG AA at minimum.'
			]
		},
		{
			heading: 'Typography',
			paragraphs: [
				'Fraunces — the voice. Serif, italic, expressive. Display, hero headlines, the wordmark, pull quotes. Never used for body or UI.',
				'Geist Sans — the room. Neutral, functional. Body, UI, navigation, buttons, forms. Weights 400, 500, 600.'
			]
		},
		{
			heading: 'Type scale',
			bullets: [
				'text-display — 64px Fraunces italic — hero only',
				'text-h1 — 48px Fraunces italic — page titles',
				'text-h2 — 32px Geist 600 — section headings',
				'text-h3 — 24px Geist 600 — sub-sections',
				'text-body-lg — 18px Geist 400 — lead paragraphs',
				'text-body — 16px Geist 400 — default body',
				'text-small — 14px Geist 400 — captions',
				'text-micro — 12px Geist 500 — labels'
			]
		}
	]
};
