import { docsNavigation } from '#lib/docs/engine.js';
import { publishedDocs } from '#lib/docs/site.server.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({
	navigation: publishedDocs ? docsNavigation(publishedDocs) : []
});
