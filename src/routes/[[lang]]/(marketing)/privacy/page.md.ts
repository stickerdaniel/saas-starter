import { LEGAL_CONFIG, getObfuscatedLegalEmailAddress } from '#lib/config/legal.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Privacy Policy',
	description: 'How we collect, use, and protect your personal data.',
	sections: [
		{
			heading: 'Privacy Policy',
			paragraphs: [
				markdownText`${LEGAL_CONFIG.brandName} is operated by ${LEGAL_CONFIG.operatorName} as a personal project. This Privacy Policy explains how we handle your personal data in accordance with the GDPR.`,
				'We collect account data (name, email, auth provider), support data (chat messages), and, only if you allow analytics, usage data (pages visited, features used).',
				'Product analytics runs only after consent in the analytics banner and can be withdrawn at any time from Privacy Settings. Events are linked to your account ID, never your name or email.',
				'We use your data to provide your account, send transactional emails, and, with consent, improve the Service. We do not sell or share your data.',
				'Third-party processors: Convex (EU Ireland, database), Vercel (Frankfurt, hosting), Resend (email), PostHog (analytics, only with consent).',
				'Under the GDPR you have the right to access, rectify, delete, restrict, port, and object to processing of your personal data.',
				markdownText`Contact: ${getObfuscatedLegalEmailAddress()}`
			]
		}
	]
};
