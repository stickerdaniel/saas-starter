import {
	LEGAL_CONFIG,
	formatPostalAddress,
	getObfuscatedLegalEmailAddress
} from '#lib/config/legal.js';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from '#lib/content/legal-metadata.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

const organizationName = LEGAL_CONFIG.companyName || LEGAL_CONFIG.operatorName;

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Contact',
	description: markdownText`Provider details, email, and support chat for ${LEGAL_CONFIG.brandName}.`,
	sections: [
		{
			heading: 'Email and support chat',
			paragraphs: [
				markdownText`Email: ${getObfuscatedLegalEmailAddress()}`,
				'Write to me by email for billing, privacy, and legal matters. Include the email address of your account and never send passwords or payment card numbers. For product questions, the support chat on the homepage answers right away and passes the conversation to me when it needs a person.'
			],
			links: [{ label: 'Support chat', href: '/en?support=open' }]
		},
		{
			heading: 'Legal notice',
			paragraphs: [
				markdownText`Last updated: ${formatLegalContentDate(LEGAL_CONTENT_DATES.impressum)}`,
				'Information pursuant to Section 5 DDG.',
				markdownText`Provider: ${organizationName}`,
				markdownText`Operated by: ${LEGAL_CONFIG.operatorName}`,
				markdownText`Address: ${formatPostalAddress(LEGAL_CONFIG.address)}`,
				markdownText`Email: ${getObfuscatedLegalEmailAddress()}`
			]
		}
	]
};
