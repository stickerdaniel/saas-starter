import { matchPublicMarketingRoute } from '$lib/marketing/public-routes';

/**
 * Cache-Control policy for document responses, applied by the
 * handleCacheControl hook. Extracted so the policy is testable against real
 * Response objects; see scripts/AGENTS.md — a security header needs a server
 * hook plus a response test.
 */
export function applyCacheControl(
	event: { url: URL; locals: { token?: string | null }; route: { id: string | null } },
	response: Response
): void {
	if (
		response.status === 200 &&
		!event.locals.token &&
		matchPublicMarketingRoute(event.url.pathname)
	) {
		// Marketing HTML shells reference content-hashed JS chunks. A cached shell
		// that survives a deploy points at chunks the new asset set no longer
		// serves, preventing hydration and arming the client-side recovery
		// backstop. no-cache keeps every reuse conditional (a 304 keeps
		// revalidation cheap) and, unlike the previous max-age=0 + s-maxage combo,
		// leaves the response non-edge-cacheable — so a fixed zone Browser Cache
		// TTL (default 4h) cannot rewrite the browser-facing max-age back up to
		// 14400, which it does to any edge-cacheable response and which let stale
		// shells sit in browsers for hours after a deploy. Immutable assets remain
		// long-cacheable. This string must stay in sync with the fallback prerendered-marketing
		// header in scripts/patch-cf-worker.ts.
		//
		// Revalidation is load-bearing, not an optimization detail: the deploy
		// recovery (version poll, beforeNavigate guard, vite:preloadError reload)
		// only covers the running app. SvelteKit has no mechanism for the initial
		// document load — a stale shell whose entry import 404s dies before any
		// listener exists. Never widen this to a max-age.
		response.headers.set('Cache-Control', 'public, no-cache');
		// These URLs also serve markdown via Accept header. CF edge ignores Vary, so
		// this is safe only because every route reaching this branch is non-prerendered
		// and the markdown variant is private (kept out of shared caches).
		response.headers.set('Vary', 'Accept');
	} else if (
		response.status === 200 &&
		!event.locals.token &&
		event.route.id?.includes('/(auth)/')
	) {
		// Auth-group HTML shells (signin, signup, forgot-password, ...) reference the
		// same content-hashed chunks as the marketing shells but fell through the
		// marketing matcher and shipped with no Cache-Control at all, leaving
		// freshness to cache heuristics. Same policy as the marketing branch: any
		// reuse must revalidate so a shell never outlives its chunk set. No
		// Vary: Accept though, these routes have no markdown variant. Matching on
		// the route group keeps new auth pages covered automatically.
		response.headers.set('Cache-Control', 'public, no-cache');
	} else if (
		event.locals.token &&
		response.headers.get('content-type')?.includes('text/html') &&
		!response.headers.has('cache-control')
	) {
		// Authenticated documents serialize viewer data into the HTML. Without an
		// explicit header they leave freshness AND shareability to whatever sits
		// in front of the origin; a self-hosted fork adding a well-meaning
		// proxy-level Cache-Control fallback (Caddy/nginx) would otherwise make
		// them shared-cacheable. Declare private at the origin so no downstream
		// fallback can widen them.
		response.headers.set('Cache-Control', 'private, no-cache');
	}
}
