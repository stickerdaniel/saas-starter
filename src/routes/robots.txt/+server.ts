import type { RequestHandler } from './$types';
import { resolveSiteOrigin } from '#lib/config/site-origin.js';
import { createRobotsTxtResponse } from '#lib/markdown/marketing.js';

export const GET: RequestHandler = ({ url }) =>
	createRobotsTxtResponse(resolveSiteOrigin(url.origin));
