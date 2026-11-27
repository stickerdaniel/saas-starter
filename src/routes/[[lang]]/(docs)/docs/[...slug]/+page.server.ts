import { error } from '@sveltejs/kit';
import { DEFAULT_LANGUAGE } from '#lib/i18n/languages.js';
import { docsPageView } from '#lib/docs/engine.js';
import { publishedDocs } from '#lib/docs/site.server.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const page =
		publishedDocs && docsPageView(publishedDocs, params.slug, params.lang ?? DEFAULT_LANGUAGE);
	if (!page) error(404, 'Not found');
	return { page };
};
