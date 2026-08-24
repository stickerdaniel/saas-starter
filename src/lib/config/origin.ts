const PRERENDER_ORIGIN = 'http://sveltekit-prerender';

export function normalizeSiteOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid site origin: ${value}`);
	}

	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new Error(`Site origin must use HTTP or HTTPS: ${value}`);
	}
	if (url.username || url.password) {
		throw new Error(`Site origin must not contain credentials: ${value}`);
	}
	if (url.pathname !== '/' || url.search || url.hash) {
		throw new Error(`Site origin must not contain a path, query, or fragment: ${value}`);
	}

	return url.origin;
}

export function resolveConfiguredSiteOrigin(
	configuredOrigin: string | undefined,
	requestOrigin: string
): string {
	if (configuredOrigin) {
		return normalizeSiteOrigin(configuredOrigin);
	}

	const fallback = normalizeSiteOrigin(requestOrigin);
	if (fallback === PRERENDER_ORIGIN) {
		throw new Error(
			'PUBLIC_SITE_URL is required when prerendering. Set it to the canonical deployment origin.'
		);
	}
	return fallback;
}
