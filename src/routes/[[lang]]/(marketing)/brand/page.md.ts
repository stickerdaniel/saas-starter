import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Brand',
	description:
		'The Cadenza brand. A LinkedIn outreach tool that reads the room before it writes a word — built on Bourdieu, Carnegie, Cialdini, Castiglione, and Ogilvy.',
	sections: [
		{
			heading: 'The one-sentence brand',
			paragraphs: [
				'Cadenza is LinkedIn outreach that reads the room before it writes a word — written in your voice, sent only when it is earned.'
			]
		},
		{
			heading: 'The name',
			paragraphs: [
				'In music, a cadenza is the moment in a concerto where the orchestra falls silent and the soloist steps forward. It is brief, personal, prepared, and remembered. A cadenza is a solo of restraint: the soloist could play forever, and chooses not to. That choice is the art.',
				'Cadenza the product treats outreach the same way. Not a broadcast. A moment.'
			]
		},
		{
			heading: 'The observation',
			paragraphs: [
				'Good outreach is a reading problem before it is a writing problem. Every tool on the market is a writing tool. Cadenza inverts the stack: it reads first, writes last, and most of the time suggests not writing at all.'
			]
		},
		{
			heading: 'Theoretical foundation',
			bullets: [
				'Bourdieu — outreach is an exchange of symbolic capital. Mass broadcast burns it.',
				'Carnegie — become genuinely interested before you try to be interesting.',
				'Cialdini — the seven principles of influence work because they are human. They fail when manufactured.',
				'Castiglione — sprezzatura: the deliberate concealment of effort. Hide the work.'
			]
		},
		{
			heading: 'Brand personality (ranked)',
			bullets: [
				'1. Restrained — say less, cut first',
				'2. Observant — specific, not general',
				'3. Earned — shown, not claimed',
				'4. Warm — kind, present, on the user’s side',
				'5. Quietly confident — no hedge, no apology'
			]
		},
		{
			heading: 'Values',
			bullets: [
				'Read before you write',
				'Less is more signal',
				'Your voice, amplified',
				'Earned attention'
			]
		},
		{
			heading: 'What Cadenza is not',
			bullets: [
				'Not a sales engagement platform',
				'Not an AI SDR',
				'Not a growth hack',
				'Not a volume play',
				'Not a CRM',
				'Not ChatGPT for LinkedIn'
			]
		}
	]
};
