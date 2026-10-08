import type { RequestHandler } from './$types';
import { resolveSiteOrigin } from '#lib/config/site-origin.js';
import { createLlmsTxtResponse } from '#lib/markdown/marketing.js';

export const GET: RequestHandler = ({ url }) =>
	createLlmsTxtResponse(resolveSiteOrigin(url.origin));
