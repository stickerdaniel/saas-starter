import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createConvexAuthHandlers } from '@mmailaender/convex-auth-svelte/sveltekit/server';

const { isAuthenticated: isAuthenticatedPromise } = createConvexAuthHandlers();

export const GET: RequestHandler = async (event) => {
	const isAuthenticated = await isAuthenticatedPromise(event);
	// return new Response();
	return json({ someData: isAuthenticated }, { status: isAuthenticated ? 200 : 403 });
};
