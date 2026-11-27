import type { RouteId } from '$app/types';
import { isSupportedLanguage } from '#lib/i18n/languages.js';

export type DocsFormat = 'html' | 'markdown';

export const DOCS_PAGE_ROUTE_ID = '/[[lang]]/(docs)/docs/[...slug]' satisfies RouteId;

/** The page route and the two routes of the `.md` twins. */
export const DOCS_ROUTE_IDS: readonly string[] = [
	DOCS_PAGE_ROUTE_ID,
	'/[[lang]]/(docs)/docs.md' satisfies RouteId,
	'/[[lang]]/(docs)/docs/[...slug].md' satisfies RouteId
];

/** The search index of the published docs, the same for every chrome language. */
export const DOCS_SEARCH_INDEX_PATH = '/api/docs/search.json';

export function docsPath(lang: string, slug: string, format: DocsFormat = 'html'): string {
	const path = slug ? `/${lang}/docs/${slug}` : `/${lang}/docs`;
	return format === 'markdown' ? `${path}.md` : path;
}

/** The language and slug of a docs page's HTML URL, which also answers `Accept: text/markdown`. */
export function matchDocsPagePath(pathname: string): { lang: string; slug: string } | null {
	const match = /^\/([a-z]{2})\/docs(?:\/(.+))?$/.exec(pathname);
	if (!match || !isSupportedLanguage(match[1]) || match[2]?.endsWith('.md')) return null;
	return { lang: match[1], slug: match[2] ?? '' };
}
