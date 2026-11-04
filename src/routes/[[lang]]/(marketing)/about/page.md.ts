import { LEGAL_CONFIG } from '#lib/config/legal.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'About',
	description: markdownText`Who runs ${LEGAL_CONFIG.brandName}, how it works with customers, and how to reach it.`,
	sections: [
		{
			heading: markdownText`About ${LEGAL_CONFIG.brandName}`,
			paragraphs: [
				markdownText`${LEGAL_CONFIG.brandName} is the personal open-source template of ${LEGAL_CONFIG.operatorName}, built on SvelteKit and Convex. ${LEGAL_CONFIG.operatorName} uses it in production for multiple projects. Besides sign-in and billing, it wires up the feedback loop with the first customers.`
			]
		},
		{
			heading: 'Who runs it',
			paragraphs: [
				markdownText`${LEGAL_CONFIG.operatorName} builds and runs ${LEGAL_CONFIG.brandName}.`
			]
		},
		{
			heading: 'How we work with customers',
			paragraphs: [
				'New accounts get a personal welcome email, and replies reach the person who sent it. Users who have not paid after 48 hours and customers who cancel are asked for feedback. The support chat hands conversations to a person when they need one. Users a production bug affected get an email after the fix is live.'
			],
			links: [
				{ label: 'Contact', href: '/en/contact', description: 'email, support chat, and address' },
				{ label: 'Privacy Policy', href: '/en/privacy' },
				{ label: 'Terms of Service', href: '/en/terms' },
				{ label: 'Impressum', href: '/en/impressum' }
			]
		}
	]
};
