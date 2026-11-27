import type { RequestHandler } from './$types';
import { resolveSiteOrigin } from '#lib/config/site-origin.js';
import { docsDiscovery } from '#lib/docs/engine.js';
import { publishedDocs } from '#lib/docs/site.server.js';
import { createLlmsTxtResponse } from '#lib/markdown/marketing.js';

export const GET: RequestHandler = ({ url }) => {
	const origin = resolveSiteOrigin(url.origin);
	return createLlmsTxtResponse(origin, docsDiscovery(publishedDocs, origin));
};
