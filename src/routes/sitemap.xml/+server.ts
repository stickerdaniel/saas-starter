import type { RequestHandler } from './$types';
import { resolveSiteOrigin } from '$lib/config/site-origin';
import { createSitemapXmlResponse } from '$lib/markdown/marketing';

export const GET: RequestHandler = ({ url }) =>
	createSitemapXmlResponse(resolveSiteOrigin(url.origin));
