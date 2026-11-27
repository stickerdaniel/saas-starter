import type { RequestHandler } from './$types';
import { resolveSiteOrigin } from '#lib/config/site-origin.js';
import { docsDiscovery } from '#lib/docs/engine.js';
import { publishedDocs } from '#lib/docs/site.server.js';
import { createSitemapXmlResponse } from '#lib/markdown/marketing.js';

export const GET: RequestHandler = ({ url }) => {
	const origin = resolveSiteOrigin(url.origin);
	return createSitemapXmlResponse(origin, docsDiscovery(publishedDocs, origin));
};
