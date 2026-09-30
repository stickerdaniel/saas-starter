/**
 * Whether PostHog may run on the current page, derived from build-time public env
 * and the hostname the page is served from.
 *
 * `PUBLIC_POSTHOG_ALLOWED_HOSTS` is the environment fence: a production key that
 * leaks into a preview or local build stays inert unless that hostname is listed.
 * It is a hostname check, not proof that the key belongs to a production project.
 */

export interface AnalyticsEnv {
	apiKey: string | undefined;
	apiHost: string | undefined;
	allowedHosts: string | undefined;
}

export type AnalyticsConfig =
	| { enabled: true; apiKey: string; apiHost: string; uiHost: string | undefined }
	| { enabled: false; reason: 'unconfigured' | 'invalid_host' | 'host_not_allowed' };

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

const UI_HOSTS: Record<string, string> = {
	'eu.i.posthog.com': 'https://eu.posthog.com',
	'us.i.posthog.com': 'https://us.posthog.com'
};

/** Exact hostnames; malformed entries (ports, paths, wildcards, spaces) are ignored. */
export function parseAllowedHosts(value: string | undefined): Set<string> {
	const hosts = new Set<string>();
	for (const entry of (value ?? '').split(',')) {
		const host = entry.trim().toLowerCase();
		if (HOSTNAME.test(host)) hosts.add(host);
	}
	return hosts;
}

/**
 * The ingestion origin, or undefined when the value is not a plain origin. https is
 * required except for local hostnames; credentials, paths, queries and fragments are
 * rejected rather than silently dropped.
 */
export function parseApiHost(value: string | undefined): string | undefined {
	if (!value) return undefined;
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return undefined;
	}
	const secure = url.protocol === 'https:';
	const local = url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname);
	if (!secure && !local) return undefined;
	if (url.username || url.password || url.search || url.hash) return undefined;
	if (url.pathname !== '/' && url.pathname !== '') return undefined;
	return url.origin;
}

export function resolveAnalyticsConfig(env: AnalyticsEnv, hostname: string): AnalyticsConfig {
	const apiKey = env.apiKey?.trim();
	if (!apiKey || !env.apiHost) return { enabled: false, reason: 'unconfigured' };

	const apiHost = parseApiHost(env.apiHost);
	if (!apiHost) return { enabled: false, reason: 'invalid_host' };

	if (!parseAllowedHosts(env.allowedHosts).has(hostname.toLowerCase())) {
		return { enabled: false, reason: 'host_not_allowed' };
	}

	return { enabled: true, apiKey, apiHost, uiHost: UI_HOSTS[new URL(apiHost).hostname] };
}
