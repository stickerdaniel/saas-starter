import { isSupportedLanguage } from '#lib/i18n/languages.js';

export const LEGAL_LINK_PREFIXES = ['*'];

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

const AMBIGUOUS_URL_CHARACTERS = /[\p{Cc}\\]/u;

function isLocalPath(url: string | null): url is string {
	return (
		url !== null &&
		url.startsWith('/') &&
		!url.startsWith('//') &&
		!AMBIGUOUS_URL_CHARACTERS.test(url)
	);
}

export function resolveLegalMarkdownLink(
	href: string,
	transformedHref: string | null,
	currentUrl: Pick<URL, 'href'>,
	localize: (path: string) => string
): ResolvedLegalMarkdownLink | null {
	if (!href || AMBIGUOUS_URL_CHARACTERS.test(href)) return null;
	if (href.startsWith('#')) return { href, external: false };
	if (href.startsWith('/')) {
		return isLocalPath(href) && isLocalPath(transformedHref)
			? { href: transformedHref, external: false }
			: null;
	}

	if (parseAbsoluteUrl(href) !== null) {
		return transformedHref === null ? null : { href: transformedHref, external: true };
	}

	const resolved = new URL(href, currentUrl.href);
	const path = `${withoutLanguagePrefix(resolved.pathname)}${resolved.search}${resolved.hash}`;
	return { href: localize(path), external: false };
}
