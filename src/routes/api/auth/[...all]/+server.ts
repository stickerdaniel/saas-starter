import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { RequestHandler } from '@sveltejs/kit';

const { GET: rawGet, POST: rawPost } = createSvelteKitHandler();

function normalizeResponse(response: Response): Response {
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: new Headers(response.headers)
	});
}

export const GET: RequestHandler = async (event) => normalizeResponse(await rawGet(event));
export const POST: RequestHandler = async (event) => normalizeResponse(await rawPost(event));
