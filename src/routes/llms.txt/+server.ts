import type { RequestHandler } from './$types';
import { resolveSiteOrigin } from '$lib/config/site-origin';
import { createLlmsTxtResponse } from '$lib/markdown/marketing';

export const GET: RequestHandler = ({ url }) =>
	createLlmsTxtResponse(resolveSiteOrigin(url.origin));
