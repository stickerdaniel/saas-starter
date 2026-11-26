import * as Duration from 'effect/Duration';

export const OAUTH_SCOPES = ['mcp:read', 'mcp:write', 'offline_access'] as const;

export const USE_RECORD_INTERVAL = Duration.hours(1);

export const RESOURCE_SCOPES = ['mcp:read', 'mcp:write'] as const;

export type ResourceScope = (typeof RESOURCE_SCOPES)[number];

export const CONSENT_PAGE_PATH = '/oauth/consent';

export const PROTECTED_RESOURCE_METADATA_PATHS = [
	'/.well-known/oauth-protected-resource',
	'/.well-known/oauth-protected-resource/mcp'
] as const;

const ANALYSIS_ORIGIN = 'https://placeholder.invalid';

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/u, '');

const siteUrl = () => withoutTrailingSlash(process.env.SITE_URL ?? ANALYSIS_ORIGIN);

const convexSiteUrl = () => withoutTrailingSlash(process.env.CONVEX_SITE_URL ?? ANALYSIS_ORIGIN);

const mcpOrigin = () => withoutTrailingSlash(process.env.MCP_PUBLIC_ORIGIN ?? convexSiteUrl());

const ALLOWED_BROWSER_ORIGINS: readonly string[] = [];

export const allowedBrowserOrigins = () =>
	new Set([new URL(siteUrl()).origin, ...ALLOWED_BROWSER_ORIGINS]);

export const issuerUrl = () => `${siteUrl()}/api/auth`;

export const mcpResourceUrl = () => `${mcpOrigin()}/mcp`;

export const mcpAudiences = () => [...new Set([`${convexSiteUrl()}/mcp`, mcpResourceUrl()])];

export const protectedResourceMetadataUrl = () =>
	`${mcpOrigin()}/.well-known/oauth-protected-resource/mcp`;

export const protectedResourceMetadata = () => ({
	resource: mcpResourceUrl(),
	authorization_servers: [issuerUrl()],
	scopes_supported: [...RESOURCE_SCOPES],
	bearer_methods_supported: ['header']
});

export const authorizationServerMetadata = <Document extends object>(document: Document) => {
	const serverToServer = `${convexSiteUrl()}/api/auth/oauth2`;
	return {
		...document,
		token_endpoint: `${serverToServer}/token`,
		registration_endpoint: `${serverToServer}/register`,
		revocation_endpoint: `${serverToServer}/revoke`,
		introspection_endpoint: `${serverToServer}/introspect`
	};
};
