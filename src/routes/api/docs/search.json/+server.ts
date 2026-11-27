import { json } from '@sveltejs/kit';
import { docsSearchIndex } from '#lib/docs/engine.js';
import { publishedDocs } from '#lib/docs/site.server.js';
import { PUBLIC_DATA_CACHE_CONTROL } from '#lib/markdown/marketing.js';
import type { RequestHandler } from './$types';

/** The search index of the published docs, or 404 while the catalog is unpublished. */
export const GET: RequestHandler = () => {
	if (!publishedDocs) {
		return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
	}
	return json(docsSearchIndex(publishedDocs), {
		headers: { 'Cache-Control': PUBLIC_DATA_CACHE_CONTROL }
	});
};
