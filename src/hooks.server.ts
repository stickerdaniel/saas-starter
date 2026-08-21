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
import { applyCacheControl } from '$lib/server/cache-control';
import { decodeJwtPayload } from '$lib/server/jwt';
import { resolveConvexToken } from '$lib/server/convex-jwt';
import { loadSentry } from '$lib/monitoring/sentry';
import { safeRedirectPath, splitDestinationError } from '$lib/utils/url';
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
 * Where to send a browser arriving on a verification link that did not work.
 *
 * Better Auth reports such a failure by appending its code to the destination
 * the link was minted with (`redirectOnError` in
 * better-auth/dist/api/routes/email-verification.mjs). That destination is an
 * ordinary page of ours and has no reason to know about it: a protected one
 * bounces to sign-in with the code buried inside `redirectTo`, where nothing
 * reads it and it rides into the next link, and a public one renders as if
 * nothing had happened. `/en/pricing?checkout=pro` is the reachable case, since
 * that is the `redirectTo` the pricing table writes for a signed-out visitor.
 *
 * Doing it here rather than on the pages is what makes it hold for every
 * destination, including the ones that do not exist yet, and it happens before
 * anything renders, so no page announces a success that did not occur.
 *
 * Returns null for sign-in itself, which is where this sends people and which
 * reads the code from the query on its own.
 *
 * A prerendered destination reaches this only because the build arranges it.
 * The generated Worker answers such a path from the asset store before any hook
 * runs, so `/en/privacy?error=TOKEN_EXPIRED` would render the privacy page and
 * say nothing. `scripts/patch-cf-worker.ts` sends a request carrying one of
 * these codes to `server.respond` instead, generating its predicate from the
 * same set read here; it is the mechanism the markdown negotiation already
 * depends on, not a new one.
 *
 * One widening rather than a hole: Better Auth appends the same
 * `INVALID_TOKEN` to a failed password-reset callback, so an expired reset link
 * now lands on sign-in with the same message instead of on a reset form that
 * ignored the parameter. Sign-in carries the forgot-password link, and the
 * token that came with it was rejected anyway.
 */
export function verificationFailureRedirect(
	pathname: string,
	search: string,
	lang: string
): string | null {
	if (/^\/[a-z]{2}\/signin$/.test(pathname)) return null;

	const { destination, errorCode } = splitDestinationError(pathname + search);
	if (errorCode === null) return null;

	return `/${lang}/signin?redirectTo=${encodeURIComponent(unwrapInterstitial(destination, lang))}&error=${errorCode}`;
}

/**
 * The real page behind a chain of verification interstitials.
 *
 * `/email-verified` is a waiting room rather than a destination, and carrying
 * one forward is what let a signed-in visitor be told an address had been
 * verified: sign-in sends an authenticated caller straight back to
 * `redirectTo`, and the failure code is not part of that value.
 *
 * It repeats because one layer is not the limit. Sign-up accepts any
 * same-origin continuation, including another interstitial, so
 * `/en/signup?redirectTo=/en/email-verified?redirectTo=/en/app` mints a link
 * whose destination is a waiting room wrapping a waiting room. The bound is
 * what guarantees termination rather than a guess about how deep that goes;
 * anything deeper is not a link this app produces and lands on the default.
 */
function unwrapInterstitial(destination: string, lang: string): string {
	let current = destination;

	for (let depth = 0; depth < 4; depth += 1) {
		let parsed: URL;
		try {
			parsed = new URL(current, 'https://redirect.invalid');
		} catch {
			return `/${lang}/app`;
		}

		if (!/^\/[a-z]{2}\/email-verified$/.test(parsed.pathname)) return current;
		current = safeRedirectPath(parsed.searchParams.get('redirectTo') ?? '', `/${lang}/app`);
	}

	return `/${lang}/app`;
}

/**
 * Handle auth redirects with language-aware paths
 */
const authFirstPattern: Handle = async function authFirstPattern({ event, resolve }) {
	const authenticated = !!event.locals.token;
	const pathname = event.url.pathname;

	// Extract language from path (e.g., /en/signin -> en)
	const langMatch = pathname.match(/^\/([a-z]{2})\//);
	const lang = langMatch?.[1] ?? DEFAULT_LANGUAGE;

	// Before every other rule, so a failed link is reported rather than wrapped
	// into `redirectTo` by the protected-route branch below. `safeUrlSearch`
	// because reading the query throws while prerendering, where no such URL
	// exists anyway.
	const verificationFailure = verificationFailureRedirect(pathname, safeUrlSearch(event.url), lang);
	if (verificationFailure !== null) {
		redirect(307, verificationFailure);
	}

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
 * Set revalidation cache headers for unauthenticated marketing pages.
 * Placed AFTER handleMarketingMarkdown — markdown requests return early
 * (no resolve() call) so this hook is skipped for them, preserving
 * the existing markdown 5-minute TTL.
 */
const handleCacheControl: Handle = async function handleCacheControl({ event, resolve }) {
	const response = await resolve(event);
	applyCacheControl(event, response);
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
