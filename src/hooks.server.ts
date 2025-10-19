import { sequence } from '@sveltejs/kit/hooks';
import {
	createConvexAuthHooks,
	createRouteMatcher
} from '@mmailaender/convex-auth-svelte/sveltekit/server';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { redirect, type Handle } from '@sveltejs/kit';
import { isSupportedLanguage, DEFAULT_LANGUAGE } from '$lib/i18n/languages';

const isSignInPage = createRouteMatcher('/:lang/signin');
const isProtectedRoute = createRouteMatcher('/:lang/app/:path*');
const isApiRoute = createRouteMatcher('/api/:path*');

const { handleAuth, isAuthenticated: isAuthenticatedPromise } = createConvexAuthHooks({
	convexUrl: PUBLIC_CONVEX_URL,
	verbose: true
});

/**
 * Handle language detection and redirect to localized URLs
 */
const handleLanguage: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;

	// Skip API routes
	if (isApiRoute(pathname)) {
		return resolve(event);
	}

	// Check if path starts with a supported language code
	const langMatch = pathname.match(/^\/([a-z]{2})(\/|$)/);
	const hasLangPrefix = langMatch && isSupportedLanguage(langMatch[1]);

	// If no language prefix, redirect to add one
	if (!hasLangPrefix) {
		// Detect preferred language from Accept-Language header
		const acceptLanguage = event.request.headers.get('accept-language');
		let preferredLang = DEFAULT_LANGUAGE;

		if (acceptLanguage) {
			// Parse Accept-Language header (e.g., "en-US,en;q=0.9,de;q=0.8")
			const languages = acceptLanguage
				.split(',')
				.map((lang) => lang.split(';')[0].trim().split('-')[0]);

			// Find first supported language
			const supported = languages.find((lang) => isSupportedLanguage(lang));
			if (supported) {
				preferredLang = supported;
			}
		}

		// Redirect to language-prefixed URL, preserving query params
		const newPath = `/${preferredLang}${pathname}${event.url.search}`;
		redirect(307, newPath);
	}

	return resolve(event);
};

/**
 * Handle auth redirects with language-aware paths
 */
const authFirstPattern: Handle = async ({ event, resolve }) => {
	const isAuthenticated = await isAuthenticatedPromise(event);
	const pathname = event.url.pathname;

	// Extract language from path (e.g., /en/signin -> en)
	const langMatch = pathname.match(/^\/([a-z]{2})\//);
	const lang = langMatch ? langMatch[1] : DEFAULT_LANGUAGE;

	if (isSignInPage(pathname) && isAuthenticated) {
		const redirectTo = event.url.searchParams.get('redirectTo');
		redirect(307, redirectTo || `/${lang}/app`);
	}
	if (isProtectedRoute(pathname) && !isAuthenticated) {
		redirect(
			307,
			`/${lang}/signin?redirectTo=${encodeURIComponent(event.url.pathname + event.url.search)}`
		);
	}

	return resolve(event);
};

export const handle = sequence(handleAuth, handleLanguage, authFirstPattern);
