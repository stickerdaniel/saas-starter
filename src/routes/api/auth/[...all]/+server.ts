import { PUBLIC_CONVEX_SITE_URL } from '$app/env/public';
import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { RequestHandler } from '@sveltejs/kit';
import { proxyAuthRequest } from '#lib/server/auth-proxy.js';

const { GET: rawGet, POST: rawPost } = createSvelteKitHandler({
	convexSiteUrl: PUBLIC_CONVEX_SITE_URL
});

export const GET: RequestHandler = (event) => proxyAuthRequest(rawGet, event);
export const POST: RequestHandler = (event) => proxyAuthRequest(rawPost, event);
