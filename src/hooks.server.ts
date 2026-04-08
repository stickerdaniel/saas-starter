import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle, type Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { PUBLIC_SENTRY_DSN } from '$env/static/public';
import * as Sentry from '@sentry/sveltekit';
import { isSupportedLanguage, DEFAULT_LANGUAGE } from '$lib/i18n/languages';
import {
	getMarketingMarkdownDocument,
	matchPublicMarketingRoute
} from '$lib/marketing/public-routes';
import { createMarketingMarkdownResponse, isMarkdownRequest } from '$lib/markdown/marketing';
import { safeRedirectPath } from '$lib/utils/url';

if (PUBLIC_SENTRY_DSN) {
	Sentry.init({
		dsn: PUBLIC_SENTRY_DSN,
		tracesSampleRate: 0.1
	});
}

/**
 * Get JWT token directly from cookies (no createAuth needed)
 * Cookie name depends on whether we're on HTTPS or HTTP
 */
function getJwtToken(cookies: Cookies, request: Request): string | undefined {
	const isSecure = new URL(request.url).protocol === 'https:';
	const cookieName = isSecure ? '__Secure-better-auth.convex_jwt' : 'better-auth.convex_jwt';
	return cookies.get(cookieName);
}

/**
 * Decode JWT payload without verification (cookie is already trusted)
 * Used for quick role checks in hooks without waiting for Convex queries
 */
function decodeJwtPayload(token: string): { role?: string } | null {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
	} catch {
		return null;
	}
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

function isEmailsRoute(pathname: string): boolean {
	return /^\/[a-z]{2}\/emails(\/|$)/.test(pathname);
}

function isEmailsApiRoute(pathname: string): boolean {
	return /^\/api\/emails(\/|$)/.test(pathname);
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
 * Block access to dev-only routes in production
 */
const handleDevOnlyRoutes: Handle = async function handleDevOnlyRoutes({ event, resolve }) {
	if (
		!dev &&
		(isEmailsRoute(event.url.pathname) ||
			isEmailsApiRoute(event.url.pathname) ||
			isShadcnDemoRoute(event.url.pathname))
	) {
		return new Response('Not found', { status: 404 });
	}
	return resolve(event);
};

/**
 * Extract authentication token from cookies
 */
const handleAuth: Handle = async function handleAuth({ event, resolve }) {
	event.locals.token = getJwtToken(event.cookies, event.request);
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

	// If no language prefix, redirect to add one
	if (!hasLangPrefix) {
		// Detect preferred language from Accept-Language header
		const acceptLanguage = event.request.headers.get('accept-language');
		let preferredLang = DEFAULT_LANGUAGE;

		if (acceptLanguage) {
			// Parse Accept-Language header (e.g., "en-US,en;q=0.9,de;q=0.8")
			const languages = acceptLanguage
				.split(',')
				.map((lang) => lang.split(';')[0]!.trim().split('-')[0]!);

			// Find first supported language
			const supported = languages.find((lang) => isSupportedLanguage(lang));
			if (supported) {
				preferredLang = supported;
			}
		}

		// Redirect to language-prefixed URL, preserving query params
		const basePath = pathname === '/' ? `/${preferredLang}` : `/${preferredLang}${pathname}`;
		redirect(307, `${basePath}${safeUrlSearch(event.url)}`);
	}

	return resolve(event);
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
		const payload = decodeJwtPayload(event.locals.token!);
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
		response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
		// These URLs also serve markdown via Accept header — Vary prevents cache cross-contamination
		response.headers.set('Vary', 'Accept');
	}

	return response;
};

/**
 * Add security headers to all responses
 */
const handleSecurityHeaders: Handle = async function handleSecurityHeaders({ event, resolve }) {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	response.headers.set('X-DNS-Prefetch-Control', 'off');
	response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	return response;
};

export const handle = sequence(
	...(PUBLIC_SENTRY_DSN ? [Sentry.sentryHandle()] : []),
	handleDevOnlyRoutes,
	handleAuth,
	handleMarketingMarkdown,
	handleLanguage,
	authFirstPattern,
	handleCacheControl,
	handleSecurityHeaders
);

export const handleError = PUBLIC_SENTRY_DSN ? Sentry.handleErrorWithSentry() : undefined;
