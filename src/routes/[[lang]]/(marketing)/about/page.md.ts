import { LEGAL_CONFIG } from '#lib/config/legal.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

const organizationName = LEGAL_CONFIG.companyName || LEGAL_CONFIG.operatorName;

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'About',
	description: markdownText`Who publishes ${LEGAL_CONFIG.brandName}, how the team works with customers, and how to reach it.`,
	sections: [
		{
			heading: markdownText`About ${LEGAL_CONFIG.brandName}`,
			paragraphs: [
				markdownText`${LEGAL_CONFIG.brandName} is an open-source SvelteKit and Convex starter. Besides sign-in and billing, it wires up the feedback loop with the first customers.`
			]
		},
		{
			heading: 'Who we are',
			paragraphs: [
				markdownText`${organizationName} publishes ${LEGAL_CONFIG.brandName} and is responsible for the service. ${LEGAL_CONFIG.operatorName} runs it day to day, from releases to answering customer questions.`
			]
		},
		{
			heading: 'How we work with customers',
			paragraphs: [
				'New accounts get a personal welcome email from one person on the team, and replies reach that person. Users who have not paid after 48 hours and customers who cancel are asked for feedback. The support chat hands conversations to the team when they need a person. Users a production bug affected get an email after the fix is live.'
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
