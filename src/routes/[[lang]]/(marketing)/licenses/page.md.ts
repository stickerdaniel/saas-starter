import { CATALOGUE_JSON_FILE, CATALOGUE_TEXT_FILE } from '$lib/licenses/catalogue';
import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Third-Party Licenses',
	description:
		'Licenses and notices for the third-party software and assets this application ships to browsers.',
	sections: [
		{
			heading: 'Third-Party Licenses',
			paragraphs: [
				'This application includes open source software and assets by third parties. The production build lists every third-party package and asset it ships to browsers, with its license declaration and the full notice texts.',
				'The catalogue is published as a file in two formats.'
			],
			links: [
				{
					label: 'Plain text',
					href: `/${CATALOGUE_TEXT_FILE}`,
					description: 'every entry with its license and notice texts'
				},
				{
					label: 'JSON',
					href: `/${CATALOGUE_JSON_FILE}`,
					description: 'the same catalogue as structured data'
				}
			]
		}
	]
};
