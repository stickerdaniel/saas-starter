import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Pricing',
	description:
		'Review the public pricing structure for the SaaS Starter template, including the free, pro, and enterprise tiers shown on the marketing site.',
	sections: [
		{
			heading: 'Pricing summary',
			paragraphs: [
				'The starter exposes three public pricing tiers: Free, Pro, and Enterprise.',
				'The pricing page includes interactive billing actions in the HTML experience, but the markdown representation is intentionally descriptive and excludes live billing behavior.'
			]
		},
		{
			heading: 'Free tier',
			bullets: [
				'Price: $0 per month',
				'10 messages per month',
				'Full source code access',
				'All features included',
				'MIT License'
			]
		},
		{
			heading: 'Pro tier',
			bullets: [
				'Price: $10 per month',
				'Unlimited messages',
				'Full source code access',
				'All features included',
				'Priority support'
			]
		},
		{
			heading: 'Enterprise tier',
			bullets: [
				'Custom pricing',
				'Custom message limits',
				'Dedicated account manager',
				'SLA guarantees',
				'Advanced security features'
			]
		},
		{
			heading: 'Billing note',
			paragraphs: [
				'The browser version of this page can trigger authentication-aware checkout and billing portal flows. The markdown version exists only to describe the plans and product packaging for agent consumption.'
			]
		}
	]
};
