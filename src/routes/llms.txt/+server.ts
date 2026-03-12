import type { RequestHandler } from './$types';
import { createLlmsTxtResponse } from '$lib/markdown/marketing';

export const GET: RequestHandler = ({ url }) => createLlmsTxtResponse(url.origin);
