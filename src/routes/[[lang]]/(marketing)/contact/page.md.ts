import { LEGAL_CONFIG, getObfuscatedLegalEmailAddress } from '#lib/config/legal.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Contact',
	description: markdownText`Email and support chat for ${LEGAL_CONFIG.brandName}.`,
	sections: [
		{
			heading: 'Email and support chat',
			paragraphs: [
				markdownText`Email: ${getObfuscatedLegalEmailAddress()}`,
				'Email me for privacy and legal matters, such as a request to see or delete your data. For product questions, the support chat on the homepage answers right away and hands the conversation to me when it needs a person.'
			],
			links: [
				{ label: 'Support chat', href: '/en?support=open' },
				{ label: 'Impressum', href: '/en/impressum', description: 'provider and postal address' }
			]
		}
	]
};
