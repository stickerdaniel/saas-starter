import { LEGAL_CONFIG, getObfuscatedLegalEmailAddress } from '$lib/config/legal';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from '$lib/content/legal-metadata';
import { markdownText } from '$lib/markdown/literals';
import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Impressum',
	description: markdownText`Provider identification and contact details for ${LEGAL_CONFIG.brandName}.`,
	sections: [
		{
			heading: 'Impressum',
			paragraphs: [
				markdownText`Last Updated: ${formatLegalContentDate(LEGAL_CONTENT_DATES.impressum)}`,
				'Information pursuant to Section 5 DDG.',
				markdownText`Provider: ${LEGAL_CONFIG.operatorName}`,
				markdownText`Address: ${LEGAL_CONFIG.address}`,
				markdownText`Email: ${getObfuscatedLegalEmailAddress()}`
			]
		}
	]
};
