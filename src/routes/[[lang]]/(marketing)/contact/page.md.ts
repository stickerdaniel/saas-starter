import {
	LEGAL_CONFIG,
	formatPostalAddress,
	getObfuscatedLegalEmailAddress
} from '#lib/config/legal.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

const organizationName = LEGAL_CONFIG.companyName || LEGAL_CONFIG.operatorName;

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Contact',
	description: markdownText`How to reach the team behind ${LEGAL_CONFIG.brandName}.`,
	sections: [
		{
			heading: 'Provider',
			paragraphs: [
				markdownText`${organizationName} operates ${LEGAL_CONFIG.brandName}.`,
				markdownText`Operated by: ${LEGAL_CONFIG.operatorName}`,
				markdownText`Address: ${formatPostalAddress(LEGAL_CONFIG.address)}`
			]
		},
		{
			heading: 'Email and support chat',
			paragraphs: [
				markdownText`Email: ${getObfuscatedLegalEmailAddress()}`,
				'Write by email for billing, privacy, and legal matters. Include the email address of your account and never send passwords or payment card numbers. For product questions, the support chat on the homepage answers right away and passes the conversation to the team when it needs a person.'
			],
			links: [
				{ label: 'Support chat', href: '/en?support=open' },
				{ label: 'Impressum', href: '/en/impressum', description: 'full provider identification' }
			]
		}
	]
};
