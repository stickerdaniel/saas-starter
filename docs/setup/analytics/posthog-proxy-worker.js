/**
 * PostHog Cloudflare Worker Proxy
 *
 * This worker acts as a reverse proxy for PostHog analytics to bypass ad blockers.
 * It will be used as a fallback when direct PostHog access is blocked by the client to minimize Cloudflare costs.
 *
 * Setup Instructions:
 * See docs/posthog-proxy-setup.md for complete deployment guide
 */

const API_HOST = 'eu.i.posthog.com'; // PostHog region API (us.i.posthog.com for US region)
const ASSET_HOST = 'eu-assets.i.posthog.com'; // PostHog region static assets (us-assets.i.posthog.com for US region)

/**
 * Main request handler
 * Routes requests to either static asset handler or API forwarder
 */
async function handleRequest(request, ctx) {
	const url = new URL(request.url);
	const pathname = url.pathname;
	const search = url.search;
	const pathWithParams = pathname + search;

	// Route static assets through cache
	if (pathname.startsWith('/static/')) {
		return retrieveStatic(request, pathWithParams, ctx);
	}

	// Forward API requests to PostHog
	return forwardRequest(request, pathWithParams);
}

/**
 * Retrieve and cache static assets
 * Uses Cloudflare's cache to minimize requests to PostHog
 */
async function retrieveStatic(request, pathname, ctx) {
	let response = await caches.default.match(request);

	if (!response) {
		response = await fetch(`https://${ASSET_HOST}${pathname}`);
		// Cache the response for future requests
		ctx.waitUntil(caches.default.put(request, response.clone()));
	}

	return response;
}

/**
 * Forward API requests to PostHog
 * Preserves client IP and removes cookies for privacy
 */
async function forwardRequest(request, pathWithSearch) {
	// Get the real client IP from Cloudflare header
	const ip = request.headers.get('CF-Connecting-IP') || '';

	// Clone headers and make necessary modifications
	const originHeaders = new Headers(request.headers);
	originHeaders.delete('cookie'); // Remove cookies for privacy
	originHeaders.set('X-Forwarded-For', ip); // Preserve client IP for geolocation

	// Create new request with modified headers
	const originRequest = new Request(`https://${API_HOST}${pathWithSearch}`, {
		method: request.method,
		headers: originHeaders,
		body: request.body,
		redirect: request.redirect
	});

	return await fetch(originRequest);
}

/**
 * Cloudflare Worker entrypoint
 */
export default {
	async fetch(request, env, ctx) {
		return handleRequest(request, ctx);
	}
};
