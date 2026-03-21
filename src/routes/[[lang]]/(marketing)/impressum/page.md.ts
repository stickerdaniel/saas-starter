import { LEGAL_CONFIG, getLegalEmailAddress } from '$lib/config/legal';
import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Impressum',
	description: 'Provider identification and contact details for SaaS Starter.',
	sections: [
		{
			heading: 'Impressum',
			paragraphs: [
				'Last Updated: March 18, 2026',
				'Information pursuant to Section 5 DDG.',
				`Provider: ${LEGAL_CONFIG.operatorName}`,
				`Address: ${LEGAL_CONFIG.address}`,
				`Email: ${getLegalEmailAddress()}`
			]
		}
	]
};
