import { isSupportedLanguage } from '$lib/i18n/languages';

export interface ResolvedLegalMarkdownLink {
	href: string;
	external: boolean;
}

function parseAbsoluteUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

function withoutLanguagePrefix(pathname: string): string {
	const segments = pathname.split('/');
	if (!isSupportedLanguage(segments[1])) return pathname;
	return `/${segments.slice(2).join('/')}`;
}

export function resolveLegalMarkdownLink(
	href: string,
	transformedHref: string | null,
	currentUrl: URL,
	localize: (path: string) => string
): ResolvedLegalMarkdownLink | null {
	if (!href || href.startsWith('//')) return null;
	if (href.startsWith('/') || href.startsWith('#')) {
		return { href, external: false };
	}

	if (parseAbsoluteUrl(href) !== null) {
		return transformedHref === null ? null : { href: transformedHref, external: true };
	}

	const resolved = new URL(href, currentUrl);
	const path = `${withoutLanguagePrefix(resolved.pathname)}${resolved.search}${resolved.hash}`;
	return { href: localize(path), external: false };
}
