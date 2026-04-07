import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Brand Resources',
	description:
		'Downloadable and copy-pasteable Cadenza brand resources: color tokens, type tokens, fonts, and logo instructions.',
	sections: [
		{
			heading: 'Color tokens',
			paragraphs: [
				'All five brand colors are shipped globally via Tailwind v4 @theme inline in layout.css: --color-brand-ink, --color-brand-terracotta, --color-brand-amber, --color-brand-cream, --color-brand-warm-white. The .brand-page class consumes them to override shadcn theme variables on brand routes only, leaving the app shell untouched.'
			]
		},
		{
			heading: 'Fonts',
			bullets: [
				'Fraunces italic 400 — /fonts/fraunces-latin-400-italic.woff2',
				'Fraunces italic 700 — /fonts/fraunces-latin-700-italic.woff2',
				'Geist Sans 400 — /fonts/geist-sans-latin-400-normal.woff2',
				'Geist Sans 500 — /fonts/geist-sans-latin-500-normal.woff2',
				'Geist Sans 600 — /fonts/geist-sans-latin-600-normal.woff2'
			]
		},
		{
			heading: 'Logo',
			paragraphs: [
				'The Cadenza wordmark is rendered live from Fraunces italic — no bitmap. Set lowercase text in Fraunces italic 400. For the gradient mark, apply a 135° linear gradient from #1A1A1A to #C75B39 with background-clip: text.'
			]
		}
	]
};
