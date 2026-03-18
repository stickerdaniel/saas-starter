import type { MarketingMarkdownDocument } from '$lib/markdown/types';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Privacy Policy',
	description: 'How we collect, use, and protect your personal data.',
	sections: [
		{
			heading: 'Privacy Policy',
			paragraphs: [
				'SaaS Starter is operated by Daniel Sticker as a personal project. This Privacy Policy explains how we handle your personal data in accordance with the GDPR.',
				'We collect account data (name, email, auth provider), usage data (analytics), and support data (chat messages).',
				'We use your data to provide your account, send transactional emails, and improve the Service. We do not sell or share your data.',
				'Third-party processors: Convex (EU Ireland, database), Vercel (Frankfurt, hosting), Resend (email), PostHog (analytics). All are GDPR-compliant.',
				'Under the GDPR you have the right to access, rectify, delete, restrict, port, and object to processing of your personal data.',
				'Contact: daniel [at] sticker [dot] name'
			]
		}
	]
};
