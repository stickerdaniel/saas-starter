import type { DocsPageEntry, DocsSourcePath } from './types';

export const STARTER_PAGES: readonly DocsPageEntry[] = [
	{ source: 'docs/introduction.md', slug: '', section: 'Getting started' },
	{ source: 'docs/getting-started.md', slug: 'getting-started', section: 'Getting started' },
	{ source: 'docs/update-models.md', slug: 'update-models', section: 'Getting started' },
	{ source: 'docs/deployment/README.md', slug: 'deployment', section: 'Deployment' },
	{ source: 'docs/deployment/previews.md', slug: 'deployment/previews', section: 'Deployment' },
	{ source: 'docs/deployment/cloudflare.md', slug: 'deployment/cloudflare', section: 'Deployment' },
	{ source: 'docs/deployment/vercel.md', slug: 'deployment/vercel', section: 'Deployment' },
	{ source: 'docs/deployment/production.md', slug: 'deployment/production', section: 'Deployment' },
	{
		source: 'docs/deployment/self-hosted.md',
		slug: 'deployment/self-hosted',
		section: 'Deployment'
	},
	{
		source: 'docs/deployment/custom-domains.md',
		slug: 'deployment/custom-domains',
		section: 'Deployment'
	},
	{ source: 'docs/features/README.md', slug: 'features', section: 'Features' },
	{ source: 'docs/features/auth.md', slug: 'features/auth', section: 'Features' },
	{ source: 'docs/features/billing.md', slug: 'features/billing', section: 'Features' },
	{ source: 'docs/features/admin.md', slug: 'features/admin', section: 'Features' },
	{ source: 'docs/features/support.md', slug: 'features/support', section: 'Features' },
	{ source: 'docs/features/email.md', slug: 'features/email', section: 'Features' },
	{ source: 'docs/features/i18n.md', slug: 'features/i18n', section: 'Features' },
	{ source: 'docs/features/analytics.md', slug: 'features/analytics', section: 'Features' },
	{ source: 'docs/features/mcp.md', slug: 'features/mcp', section: 'Features' },
	{
		source: 'docs/features/agents-and-seo.md',
		slug: 'features/agents-and-seo',
		section: 'Features'
	},
	{ source: 'docs/features/accessibility.md', slug: 'features/accessibility', section: 'Features' },
	{ source: 'docs/reference/environment.md', slug: 'reference/environment', section: 'Reference' },
	{ source: 'docs/development.md', slug: 'development', section: 'Reference' }
];

export const UNPUBLISHED_DOCS: readonly DocsSourcePath[] = [
	'docs/AGENTS.md',
	'docs/README.md',
	'docs/decisions/2026-10-04-license-page-server-rendering.md',
	'docs/decisions/2026-10-04-third-party-license-notices.md',
	'docs/decisions/2026-10-15-licenses-page-in-admin.md',
	'docs/decisions/2026-11-27-remote-mcp-on-the-oauth-provider.md',
	'docs/recipes/optimize-support-prompt.md',
	'docs/setup/admin-notifications/customer-emails.md',
	'docs/setup/analytics/posthog.md',
	'docs/setup/customer-support/screenshot-proxy-setup.md',
	'docs/setup/i18n/i18n-setup.md'
];
