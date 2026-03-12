import type { RequestHandler } from './$types';
import { createRobotsTxtResponse } from '$lib/markdown/marketing';

export const GET: RequestHandler = ({ url }) => createRobotsTxtResponse(url.origin);
