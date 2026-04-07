import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Voice & Tone',
	description:
		'The Cadenza voice: restrained, observant, specific. Six rules, a vocabulary the brand uses and a vocabulary it refuses, and a tone spectrum that flexes without changing the voice.',
	sections: [
		{
			heading: 'Voice rules',
			bullets: [
				'Brevity signals confidence — if you can cut a word, cut it.',
				'Specificity over abstraction — “reads 47 of their recent posts” beats “leverages contextual insights.”',
				'Active voice, present tense.',
				'One exclamation mark per page, maximum, and only when earned.',
				'Lowercase by default. Sentence case in UI, headlines, buttons.',
				'No filler — no seamlessly, leverage, unlock, revolutionary, game-changing, AI-powered, supercharge.'
			]
		},
		{
			heading: 'Vocabulary we use',
			bullets: [
				'outreach',
				'message',
				'profile',
				'context',
				'voice',
				'reads the room',
				'in your voice',
				'earned attention',
				'the right moment',
				'a message worth sending'
			]
		},
		{
			heading: 'Vocabulary we refuse',
			bullets: [
				'blast, campaign, cadence, sequence',
				'touchpoint, asset, comms',
				'lead, target, prospect, contact',
				'personalizes at scale',
				'AI-generated, AI-written',
				'growth hack, conversion lift',
				'optimal send time',
				'high-converting message'
			]
		},
		{
			heading: 'Tone spectrum',
			bullets: [
				'Marketing — confident, slightly warm, grounded',
				'Product UI — functional, brief, helpful',
				'Errors — direct, calm, useful',
				'Onboarding & empty states — warm, guiding, never patronizing'
			]
		}
	]
};
