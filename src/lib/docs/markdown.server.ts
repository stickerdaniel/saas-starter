import type { RequestHandler } from '@sveltejs/kit';
import { resolveSiteOrigin } from '#lib/config/site-origin.js';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from '#lib/i18n/languages.js';
import {
	createPublicMarkdownNotFoundResponse,
	MARKDOWN_CACHE_CONTROL,
	MARKDOWN_CONTENT_TYPE
} from '#lib/markdown/marketing.js';
import { docsMarkdown } from './engine';
import { publishedDocs } from './site.server';
import { docsPath } from './urls';

/** The Markdown twin of a published page, for its `.md` URL and for `Accept: text/markdown` on its HTML URL. */
export function docsMarkdownResponse(lang: string, slug: string, origin: string): Response | null {
	const markdown = publishedDocs && docsMarkdown(publishedDocs, slug, lang, origin);
	if (markdown === null) return null;
	return new Response(markdown, {
		headers: {
			'Content-Type': MARKDOWN_CONTENT_TYPE,
			'Content-Language': 'en',
			'Cache-Control': MARKDOWN_CACHE_CONTROL,
			Vary: 'Accept',
			Link: `<${origin}${docsPath(DEFAULT_LANGUAGE, slug)}>; rel="canonical"`
		}
	});
}

/** A `.md` URL answers Markdown, the not-found page included. */
export const GET: RequestHandler<{ lang?: string; slug?: string }> = ({ params, url }) => {
	const origin = resolveSiteOrigin(url.origin);
	const lang = isSupportedLanguage(params.lang) ? params.lang : DEFAULT_LANGUAGE;
	return (
		(isSupportedLanguage(params.lang) && docsMarkdownResponse(lang, params.slug ?? '', origin)) ||
		createPublicMarkdownNotFoundResponse(new Response(null, { status: 404 }), { origin, lang })
	);
};
