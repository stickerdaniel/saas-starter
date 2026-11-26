export const OAUTH_SCOPES = ['mcp:read', 'mcp:write', 'offline_access'] as const;

export const CONSENT_PAGE_PATH = '/oauth/consent';

const ANALYSIS_ORIGIN = 'https://placeholder.invalid';

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/u, '');

const convexSiteUrl = () => withoutTrailingSlash(process.env.CONVEX_SITE_URL ?? ANALYSIS_ORIGIN);

const mcpOrigin = () => withoutTrailingSlash(process.env.MCP_PUBLIC_ORIGIN ?? convexSiteUrl());

export const mcpResourceUrl = () => `${mcpOrigin()}/mcp`;

export const mcpAudiences = () => [...new Set([`${convexSiteUrl()}/mcp`, mcpResourceUrl()])];

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
