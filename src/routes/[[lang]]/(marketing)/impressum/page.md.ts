import { LEGAL_CONFIG, getLegalEmailAddress } from '$lib/config/legal';
import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Impressum',
	description: 'Provider identification and contact details for SaaS Starter.',
	sections: [
		{
			heading: 'Impressum',
			paragraphs: [
				'Angaben gemaess Paragraph 5 DDG.',
				`Anbieter: ${LEGAL_CONFIG.operatorName}`,
				`Adresse: ${LEGAL_CONFIG.address}`,
				`E-Mail: ${getLegalEmailAddress()}`
			]
		}
	]
};
