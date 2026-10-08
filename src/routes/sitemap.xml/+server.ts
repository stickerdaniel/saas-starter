import type { RequestHandler } from './$types';
import { resolveSiteOrigin } from '#lib/config/site-origin.js';
import { createSitemapXmlResponse } from '#lib/markdown/marketing.js';

export const GET: RequestHandler = ({ url }) =>
	createSitemapXmlResponse(resolveSiteOrigin(url.origin));
