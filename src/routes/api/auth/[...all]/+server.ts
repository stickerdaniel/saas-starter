import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { RequestHandler } from '@sveltejs/kit';
import { proxyAuthRequest } from '$lib/server/auth-proxy';

const { GET: rawGet, POST: rawPost } = createSvelteKitHandler();

export const GET: RequestHandler = (event) => proxyAuthRequest(rawGet, event);
export const POST: RequestHandler = (event) => proxyAuthRequest(rawPost, event);
