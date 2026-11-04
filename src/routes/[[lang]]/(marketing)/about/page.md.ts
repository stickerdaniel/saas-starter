import { LEGAL_CONFIG } from '#lib/config/legal.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'About',
	description: markdownText`Who runs ${LEGAL_CONFIG.brandName}, how it works with customers, and how to reach it.`,
	sections: [
		{
			heading: markdownText`About ${LEGAL_CONFIG.brandName}`,
			paragraphs: [
				markdownText`${LEGAL_CONFIG.brandName} is my personal open-source template, built on SvelteKit and Convex. I use it in production for multiple projects. Besides sign-in and billing, it wires up the feedback loop with your first customers.`
			]
		},
		{
			heading: 'Who runs it',
			paragraphs: [
				markdownText`I'm ${LEGAL_CONFIG.operatorName}. I build and run ${LEGAL_CONFIG.brandName} myself.`
			]
		},
		{
			heading: 'How I work with customers',
			paragraphs: [
				'Once I switch them on, verified new accounts get a personal welcome email whose replies reach me, accounts that have not paid about 48 hours after verification and customers who cancel a paid plan are asked for feedback, and users a production bug affected can get an email from me after the fix is live. The support chat hands conversations to me when they need a person.'
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
