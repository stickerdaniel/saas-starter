import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { PUBLIC_SENTRY_DSN } from '$env/static/public';
import { isSupportedLanguage, DEFAULT_LANGUAGE, LANGUAGE_COOKIE_NAME } from '$lib/i18n/languages';
import {
	getMarketingMarkdownDocument,
	matchPublicMarketingRoute
} from '$lib/marketing/public-routes';
import { createMarketingMarkdownResponse, isMarkdownRequest } from '$lib/markdown/marketing';
import { devNotice } from '$lib/dev/notice';
import { decodeJwtPayload } from '$lib/server/jwt';
import { resolveConvexToken } from '$lib/server/convex-jwt';
import { loadSentry } from '$lib/monitoring/sentry';
import { safeRedirectPath } from '$lib/utils/url';
import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';

if (!PUBLIC_SENTRY_DSN) {
	devNotice({
		feature: 'Error monitoring (Sentry)',
		missing: ['PUBLIC_SENTRY_DSN'],
		scope: 'vite-public'
	});
}

// Route matchers
function isAuthPage(pathname: string): boolean {
	return /^\/[a-z]{2}\/(signin|signup)$/.test(pathname);
}

function isProtectedRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/app(\/|$)/.test(pathname);
}

function isAdminRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/admin(\/|$)/.test(pathname);
}

function isShadcnDemoRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/shadcn-demo(\/|$)/.test(pathname);
}

/**
 * Safely access event.url.search — throws during prerendering
 */
function safeUrlSearch(url: URL): string {
	try {
		return url.search;
	} catch {
		return '';
	}
}

export function shouldBypassLanguageRedirect(pathname: string): boolean {
	if (pathname.startsWith('/api')) {
		return true;
	}

	const normalizedPath = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
	return ['/llms.txt', '/robots.txt', '/sitemap.xml'].includes(normalizedPath);
}

/**
 * Resolve the language for a bare/prefixless path. Precedence:
 *   1. an explicit choice in the lang_pref cookie (only if supported),
 *   2. the first supported Accept-Language tag,
 *   3. DEFAULT_LANGUAGE.
 * Exported for the unit guard. The cookie value is untrusted, so it is validated.
 */
export function resolveBarePathLanguage(
	cookieValue: string | undefined,
	acceptLanguage: string | null
): string {
	if (isSupportedLanguage(cookieValue)) {
		return cookieValue;
	}
	if (acceptLanguage) {
		const tags = acceptLanguage.split(',').map((lang) => lang.split(';')[0]!.trim().split('-')[0]!);
		const supported = tags.find((lang) => isSupportedLanguage(lang));
		if (supported) return supported;
	}
	return DEFAULT_LANGUAGE;
}

/**
 * Block access to dev-only routes in production
 */
const handleDevOnlyRoutes: Handle = async function handleDevOnlyRoutes({ event, resolve }) {
	if (!dev && isShadcnDemoRoute(event.url.pathname)) {
		return new Response('Not found', { status: 404 });
	}
	return resolve(event);
};

/**
 * Resolve the Convex JWT for SSR: from the short-lived JWT cookie when it is
 * still alive, otherwise re-minted from the Better Auth session cookie (see
 * $lib/server/convex-jwt). Without the re-mint, a tab idle past the JWT TTL
 * gets bounced to /signin on the next full load even though the session is
 * still valid.
 */
const handleAuth: Handle = async function handleAuth({ event, resolve }) {
	event.locals.token = await resolveConvexToken(event);
	return resolve(event);
};

/**
 * Read persisted sidebar open/collapsed state so SSR renders the correct first
 * paint and the authenticated shell does not flash a full-width content reflow
 * on reload. Read here (not in a +layout.server.ts load) so prerendered
 * marketing pages stay buildable — the same reason the JWT token flows through
 * locals. Defaults to open when the cookie is absent.
 */
const handleSidebarState: Handle = async function handleSidebarState({ event, resolve }) {
	event.locals.sidebarOpen = event.cookies.get(SIDEBAR_COOKIE_NAME) !== 'false';
	return resolve(event);
};

const handleMarketingMarkdown: Handle = async function handleMarketingMarkdown({ event, resolve }) {
	if (!['GET', 'HEAD'].includes(event.request.method)) {
		return resolve(event);
	}

	if (!isMarkdownRequest(event.request)) {
		return resolve(event);
	}

	const matchedRoute = matchPublicMarketingRoute(event.url.pathname);
	if (!matchedRoute) {
		return resolve(event);
	}

	return createMarketingMarkdownResponse(getMarketingMarkdownDocument(matchedRoute.routeKey), {
		origin: event.url.origin,
		pathname: event.url.pathname,
		lang: matchedRoute.lang ?? DEFAULT_LANGUAGE
	});
};

/**
 * Handle language detection and redirect to localized URLs
 */
const handleLanguage: Handle = async function handleLanguage({ event, resolve }) {
	const pathname = event.url.pathname;

	// Skip routes that should stay at the root or manage their own content negotiation
	if (shouldBypassLanguageRedirect(pathname)) {
		return resolve(event);
	}

	// Check if path starts with a supported language code
	const langMatch = pathname.match(/^\/([a-z]{2})(\/|$)/);
	const hasLangPrefix = langMatch ? isSupportedLanguage(langMatch[1]) : false;

	// If no language prefix, redirect to add one. An explicit lang_pref cookie
	// choice wins; Accept-Language is the fallback.
	if (!hasLangPrefix) {
		const preferredLang = resolveBarePathLanguage(
			event.cookies.get(LANGUAGE_COOKIE_NAME),
			event.request.headers.get('accept-language')
		);
		const basePath = pathname === '/' ? `/${preferredLang}` : `/${preferredLang}${pathname}`;
		redirect(307, `${basePath}${safeUrlSearch(event.url)}`);
	}

	return resolve(event);
};

/**
 * Substitute the %lang% placeholder in app.html with the request's language so
 * SSR and prerendered HTML ship the correct <html lang> on first paint for
 * non-JS crawlers and screen readers. Derives lang from the pathname the same
 * way handleLanguage does; defaults to DEFAULT_LANGUAGE for any unprefixed or
 * unsupported path (handleLanguage already 307-redirects those before render).
 * The client-side watch in +layout.svelte keeps lang in sync across SPA
 * navigations. Reading event.url.pathname is prerender-safe (handleLanguage
 * reads it unconditionally); only url.search/searchParams throw during prerender.
 */
const handleHtmlLang: Handle = async function handleHtmlLang({ event, resolve }) {
	const langMatch = event.url.pathname.match(/^\/([a-z]{2})(\/|$)/);
	const lang = langMatch && isSupportedLanguage(langMatch[1]) ? langMatch[1] : DEFAULT_LANGUAGE;
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', lang)
	});
};

/**
 * Handle auth redirects with language-aware paths
 */
const authFirstPattern: Handle = async function authFirstPattern({ event, resolve }) {
	const authenticated = !!event.locals.token;
	const pathname = event.url.pathname;

	// Extract language from path (e.g., /en/signin -> en)
	const langMatch = pathname.match(/^\/([a-z]{2})\//);
	const lang = langMatch ? langMatch[1] : DEFAULT_LANGUAGE;

	if (isAuthPage(pathname) && authenticated) {
		// Defer searchParams access to avoid errors during prerendering
		const redirectToParam = event.url.searchParams.get('redirectTo');
		const destination = safeRedirectPath(redirectToParam ?? '', `/${lang}/app`);
		redirect(307, destination);
	}
	if (isProtectedRoute(pathname) && !authenticated) {
		const destination = `/${lang}/signin?redirectTo=${encodeURIComponent(event.url.pathname + safeUrlSearch(event.url))}`;
		redirect(307, destination);
	}

	// Admin routes require authentication AND admin role
	if (isAdminRoute(pathname)) {
		if (!authenticated) {
			const destination = `/${lang}/signin?redirectTo=${encodeURIComponent(event.url.pathname + safeUrlSearch(event.url))}`;
			redirect(307, destination);
		}
		// Check admin role from JWT payload (fast, no Convex query needed)
		const payload = decodeJwtPayload(event.locals.token);
		if (payload?.role !== 'admin') {
			redirect(307, `/${lang}/app`);
		}
	}

	return resolve(event);
};

/**
 * Set edge cache headers for unauthenticated marketing pages.
 * Placed AFTER handleMarketingMarkdown — markdown requests return early
 * (no resolve() call) so this hook is skipped for them, preserving
 * the existing markdown 5-minute TTL.
 */
const handleCacheControl: Handle = async function handleCacheControl({ event, resolve }) {
	const response = await resolve(event);

	if (
		response.status === 200 &&
		!event.locals.token &&
		matchPublicMarketingRoute(event.url.pathname)
	) {
		// max-age=0, must-revalidate asks the browser to revalidate the HTML shell on
		// every navigation (a 304 keeps it cheap) so the location.href recovery in the
		// root layout fetches a fresh shell instead of re-reading a stale one that
		// references deleted chunk hashes. s-maxage keeps the shared edge cache.
		//
		// Necessary but not sufficient on Cloudflare. A fixed zone Browser Cache TTL
		// (default 4h) acts as a floor: CF rewrites the browser-facing max-age back up
		// to 14400 whenever the origin value is lower, and this response stays
		// edge-cacheable (public + s-maxage), so max-age=0 is overridden until the zone
		// is reconfigured. See developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/.
		// Required CF change (zone-level, not expressible from origin headers): set
		// Browser Cache TTL to "Respect Existing Headers", or add a Cache Rule scoped to
		// the marketing HTML paths that does the same. Verify after deploy: the live
		// Cache-Control on /en must NOT carry an injected max-age=14400.
		//
		// This string must stay in sync with the prerendered marketing HTML header in
		// scripts/patch-cf-worker.ts.
		response.headers.set(
			'Cache-Control',
			'public, max-age=0, must-revalidate, s-maxage=3600, stale-while-revalidate=86400'
		);
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
		// freshness to cache heuristics. Any reuse must revalidate so a shell never
		// outlives its chunk set. Unlike the marketing branch there is no s-maxage:
		// auth shells are not edge-cached, so the zone Browser Cache TTL floor
		// documented above does not apply. No Vary: Accept either, these routes have
		// no markdown variant. Matching on the route group keeps new auth pages
		// covered automatically.
		response.headers.set('Cache-Control', 'public, no-cache');
	}

	return response;
};

/**
 * Forward requests through Sentry's request handler, loading the SDK lazily
 * (see $lib/monitoring/sentry) so it stays out of the server bundle and cold
 * start when PUBLIC_SENTRY_DSN is unset. The DSN is statically replaced at
 * build time, so the unset case reduces this hook to a plain pass-through.
 * The sentryHandle() instance is memoized per server process.
 */
let sentryRequestHandle: Handle | null = null;

const handleSentry: Handle = async function handleSentry({ event, resolve }) {
	if (!PUBLIC_SENTRY_DSN) {
		return resolve(event);
	}
	if (!sentryRequestHandle) {
		const sentry = await loadSentry();
		if (!sentry) {
			return resolve(event);
		}
		sentryRequestHandle = sentry.sentryHandle();
	}
	return sentryRequestHandle({ event, resolve });
};

/**
 * Add security headers to all responses
 */
const handleSecurityHeaders: Handle = async function handleSecurityHeaders({ event, resolve }) {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=(), serial=()'
	);
	response.headers.set('X-DNS-Prefetch-Control', 'off');
	response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	// script-src/object-src/base-uri now live in kit.csp (svelte.config.js): on SSR
	// pages SvelteKit sets the Content-Security-Policy header, on prerendered pages a
	// <meta>. frame-ancestors cannot ride a <meta> and SvelteKit can't set headers on
	// prerendered static pages, so it stays a header here (SSR) and in _headers /
	// vercel.json (prerendered). Append rather than overwrite: a plain headers.set
	// would clobber the object-src/base-uri header SvelteKit already set on SSR pages.
	const kitCsp = response.headers.get('Content-Security-Policy');
	response.headers.set(
		'Content-Security-Policy',
		kitCsp ? `${kitCsp}; frame-ancestors 'none'` : "frame-ancestors 'none'"
	);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
	response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	return response;
};

export const handle = sequence(
	handleSentry,
	handleDevOnlyRoutes,
	handleAuth,
	handleSidebarState,
	handleMarketingMarkdown,
	handleLanguage,
	handleHtmlLang,
	authFirstPattern,
	handleCacheControl,
	handleSecurityHeaders
);

// Memoized Sentry error handler, created on first error so the SDK import
// stays lazy. When the DSN is unset the export is undefined, same as before.
let sentryHandleError: HandleServerError | null = null;

export const handleError: HandleServerError | undefined = PUBLIC_SENTRY_DSN
	? async (input) => {
			if (!sentryHandleError) {
				const sentry = await loadSentry();
				if (!sentry) return;
				sentryHandleError = sentry.handleErrorWithSentry<HandleServerError>();
			}
			return sentryHandleError(input);
		}
	: undefined;
