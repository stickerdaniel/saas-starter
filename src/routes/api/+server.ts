import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	// Check auth via token from hooks
	const isAuthenticated = !!event.locals.token;
	return json({ someData: isAuthenticated }, { status: isAuthenticated ? 200 : 403 });
};
