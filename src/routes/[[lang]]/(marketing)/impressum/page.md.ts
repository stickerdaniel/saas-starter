import { LEGAL_CONFIG, getObfuscatedLegalEmailAddress } from '$lib/config/legal';
import { LEGAL_CONTENT_DATES, formatLegalContentDate } from '$lib/content/legal-metadata';
import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Impressum',
	description: `Provider identification and contact details for ${LEGAL_CONFIG.brandName}.`,
	sections: [
		{
			heading: 'Impressum',
			paragraphs: [
				`Last Updated: ${formatLegalContentDate(LEGAL_CONTENT_DATES.impressum)}`,
				'Information pursuant to Section 5 DDG.',
				`Provider: ${LEGAL_CONFIG.operatorName}`,
				`Address: ${LEGAL_CONFIG.address}`,
				`Email: ${getObfuscatedLegalEmailAddress()}`
			]
		}
	]
};
