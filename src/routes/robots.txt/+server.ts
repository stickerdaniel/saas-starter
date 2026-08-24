import type { RequestHandler } from './$types';
import { resolveSiteOrigin } from '$lib/config/site-origin';
import { createRobotsTxtResponse } from '$lib/markdown/marketing';

export const GET: RequestHandler = ({ url }) =>
	createRobotsTxtResponse(resolveSiteOrigin(url.origin));
