import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Motion',
	description:
		'Cadenza motion principles: purposeful, restrained, physical, quiet. Motion should feel earned, not decorative.',
	sections: [
		{
			heading: 'Motion principles',
			bullets: [
				'Purposeful — reinforces hierarchy or causality, nothing else.',
				'Restrained — 200ms default, ease-out, anything over 400ms must justify itself.',
				'Physical — things accelerate from rest and decelerate to rest.',
				'Quiet — no spinners. Use shimmer, skeleton, or a single steady pulse.',
				'Reduced motion respected — every animation has a prefers-reduced-motion fallback that is “no animation,” not “less animation.”'
			]
		},
		{
			heading: 'Shader library',
			bullets: [
				'Vibrant Waves — home hero. The reading metaphor as fluid attention.',
				'Quantum — technology moments. Discrete points coalescing into shape.',
				'Heatwave — warmth-forward moments, testimonials, founder notes.',
				'Oil Slick — premium tier accents. Earned luxury.',
				'Ember — footer atmospheres. Quiet glow.'
			]
		},
		{
			heading: 'Timing tokens',
			bullets: [
				'--motion-fast — 100ms, ease-out — hover, focus',
				'--motion-base — 200ms, ease-out — default UI',
				'--motion-slow — 400ms, ease-out — panels',
				'--motion-emphasis — 800ms, ease-out — brand moments only'
			]
		}
	]
};
