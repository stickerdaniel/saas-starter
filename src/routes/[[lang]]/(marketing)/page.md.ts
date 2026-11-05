import { LEGAL_CONFIG } from '#lib/config/legal.js';
import { markdownText } from '#lib/markdown/literals.js';
import type { MarketingMarkdownDocument } from '#lib/markdown/types.js';

export const marketingMarkdown: MarketingMarkdownDocument = {
	title: 'Built for the Day After Launch',
	description:
		'An open-source SvelteKit and Convex starter with auth and billing, plus the feedback loop that starts with your first customer.',
	sections: [
		{
			heading: 'What this starter is',
			paragraphs: [
				markdownText`${LEGAL_CONFIG.brandName} is an open-source SaaS starter built on SvelteKit, Convex, Better Auth, Autumn, and Resend. Besides auth and billing, it wires up the feedback loop that starts with the first customer.`,
				'Features only move into the starter once a product uses them in production, and each product can pull the fixes made here through a reviewed upstream sync.'
			]
		},
		{
			heading: 'The feedback loop after launch',
			bullets: [
				'Launch: pushes deploy, and pull requests get previews. Analytics, error tracking and admin metrics are wired in before the first user.',
				'Talk to users: new users get a personal welcome email from you, and replies reach your inbox. The support AI answers and hands you threads that need a human.',
				'Learn what they do: you get an email when a customer first pays, with what they did before paying.',
				'Fix it and tell them: after a production fix, an agent can find who the evidence shows was hit and draft one email for you to approve.',
				'Also included: plan limits with an upgrade path, and markdown versions of every marketing page plus /llms.txt for AI agents.'
			]
		},
		{
			heading: 'Built on',
			links: [
				{
					label: 'Svelte 5',
					href: 'https://svelte.dev',
					description: 'Server-rendered pages, with markdown answers for AI agents'
				},
				{
					label: 'Convex',
					href: 'https://convex.dev',
					description: 'Data, background jobs, and live updates in one typed backend'
				},
				{
					label: 'Better Auth',
					href: 'https://www.better-auth.com/',
					description: 'Email and password, passkeys, and OAuth, stored in your own database'
				},
				{
					label: 'Autumn',
					href: 'https://useautumn.com/',
					description: 'Plans, Stripe checkout, and usage limits with an upgrade path'
				},
				{
					label: 'Tolgee',
					href: 'https://tolgee.io',
					description: 'Four languages, with translations kept in the repository'
				},
				{
					label: 'PostHog',
					href: 'https://posthog.com/',
					description: 'Product analytics that loads only after consent'
				},
				{
					label: 'Resend',
					href: 'https://resend.com',
					description: 'Welcome, verification, and incident emails'
				}
			]
		},
		{
			heading: 'Primary call to action',
			paragraphs: ['The primary action on the page is sign-up for the starter experience.'],
			links: [
				{
					label: 'Start building',
					href: '/en/signup',
					description: 'Create an account and enter the product flow'
				}
			]
		}
	]
};
