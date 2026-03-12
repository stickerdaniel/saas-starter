import type { RequestHandler } from './$types';
import { createSitemapXmlResponse } from '$lib/markdown/marketing';

export const GET: RequestHandler = ({ url }) => createSitemapXmlResponse(url.origin);
