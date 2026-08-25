export interface ResolvedLegalMarkdownLink {
	href: string;
	external: boolean;
}

function parseUrl(url: string, defaultOrigin?: string): URL | null {
	try {
		return new URL(url);
	} catch {
		if (!defaultOrigin) return null;
		try {
			return new URL(url, defaultOrigin);
		} catch {
			return null;
		}
	}
}

export function transformAllowedExternalUrl(
	href: string,
	allowedPrefixes: string[],
	defaultOrigin?: string
): string | null {
	const parsedUrl = parseUrl(href, defaultOrigin);
	if (!parsedUrl) return null;

	const absoluteUrl = parseUrl(href);
	if (
		absoluteUrl &&
		allowedPrefixes.some((prefix) => {
			const parsedPrefix = parseUrl(prefix);
			return (
				parsedPrefix !== null &&
				parsedPrefix.origin === absoluteUrl.origin &&
				absoluteUrl.href.startsWith(parsedPrefix.href)
			);
		})
	) {
		return absoluteUrl.href;
	}

	if (
		allowedPrefixes.includes('*') &&
		(parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:')
	) {
		return parsedUrl.href;
	}

	return null;
}

export function resolveLegalMarkdownLink(
	href: string,
	localize: (path: string) => string,
	allowedPrefixes: string[],
	defaultOrigin?: string
): ResolvedLegalMarkdownLink | null {
	if (!href) return null;

	if (href.startsWith('/') || href.startsWith('#')) {
		return { href, external: false };
	}

	if (parseUrl(href) === null) {
		return { href: localize(`/${href}`), external: false };
	}

	const externalHref = transformAllowedExternalUrl(href, allowedPrefixes, defaultOrigin);
	return externalHref === null ? null : { href: externalHref, external: true };
}
