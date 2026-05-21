import { LEGAL_CONFIG } from '$lib/config/legal';
import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Terms of Service',
	description: `The terms and conditions for using ${LEGAL_CONFIG.brandName}.`,
	sections: [
		{
			heading: 'Terms of Service',
			paragraphs: [
				`By accessing or using ${LEGAL_CONFIG.brandName} you agree to be bound by these Terms of Service.`,
				`${LEGAL_CONFIG.brandName} is a web application template and starter kit provided by ${LEGAL_CONFIG.operatorName} as a personal project.`,
				'You are responsible for maintaining the confidentiality of your account credentials.',
				'The Service is provided "as is" without warranties of any kind.',
				'These Terms are governed by the laws of the Federal Republic of Germany.'
			]
		}
	]
};
