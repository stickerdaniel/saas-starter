import { LEGAL_CONFIG } from '#lib/config/legal.js';
import { operatorFirstName } from '#lib/content/operator.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'About',
	description: markdownText`What ${LEGAL_CONFIG.brandName} is, who runs it, and how to reach me.`,
	sections: [
		{
			heading: markdownText`About ${LEGAL_CONFIG.brandName}`,
			paragraphs: [
				markdownText`${LEGAL_CONFIG.brandName} is an open-source template for SaaS products, built with SvelteKit and Convex. It includes sign-in, billing, an admin panel, AI chat, a support chat, email, and translations.`,
				markdownText`I (${operatorFirstName}) maintain it and use it in production for several of my own projects.`
			]
		},
		{
			heading: 'Customer contact',
			paragraphs: [
				'The template includes optional emails: a welcome email from a named person after email verification, a feedback request to accounts that have not paid about 48 hours after verification, a cancellation email, and an incident email to accounts a fixed production bug affected. The support chat hands conversations to a person when needed.'
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
