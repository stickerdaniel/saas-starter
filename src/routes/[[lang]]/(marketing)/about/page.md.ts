import { LEGAL_CONFIG } from '#lib/config/legal.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

const organizationName = LEGAL_CONFIG.companyName || LEGAL_CONFIG.operatorName;

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'About',
	description: markdownText`Who publishes ${LEGAL_CONFIG.brandName}, what it does, and how to reach the team.`,
	sections: [
		{
			heading: markdownText`About ${LEGAL_CONFIG.brandName}`,
			paragraphs: [
				markdownText`${LEGAL_CONFIG.brandName} is a web application that helps teams launch and run a subscription software product. It combines sign-up and sign-in, subscription billing, transactional email, a customer support chat, and product analytics in one service.`
			]
		},
		{
			heading: 'Who we are',
			paragraphs: [
				markdownText`${organizationName} publishes ${LEGAL_CONFIG.brandName} and is responsible for the service. ${LEGAL_CONFIG.operatorName} runs it day to day, from product decisions and releases to answering customer questions.`
			]
		},
		{
			heading: 'How we work',
			paragraphs: [
				'We ship in small, frequent releases and shape the roadmap around the questions customers send us. We collect only the personal data the service needs.'
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
