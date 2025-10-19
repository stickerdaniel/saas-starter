import { DEFAULT_LANGUAGE } from '$lib/i18n/languages';
import { page } from '$app/state';
import { useLanguage as useLanguageContext } from '$lib/i18n/context';

/**
 * Get the current language from context
 *
 * Use this when you need direct access to the language value (e.g., in LanguageSwitcher)
 * Most components should use `localizedHref()` instead, which automatically reads language from page state
 */
export { useLanguageContext as useLanguage };

/**
 * Generate a language-prefixed URL
 * Automatically reads current language from page state
 *
 * @param path - The path to localize (e.g., '/pricing', '/app')
 * @returns Localized path (e.g., '/de/pricing', '/es/app')
 *
 * @example
 * // Auto-detect language from page state (preferred)
 * localizedHref('/pricing')  // Returns '/de/pricing' if current lang is 'de'
 * localizedHref('#features')  // Returns '#features' (anchors unchanged)
 * localizedHref('https://example.com')  // Returns 'https://example.com' (external URLs unchanged)
 */
export function localizedHref(path: string): string;

/**
 * Generate a language-prefixed URL with explicit language
 *
 * @param path - The path to localize (e.g., '/pricing', '/app')
 * @param lang - Explicit language code (e.g., 'en', 'de', 'es')
 * @returns Localized path (e.g., '/de/pricing', '/es/app')
 *
 * @example
 * // Explicit language override
 * localizedHref('/pricing', 'de')  // Returns '/de/pricing' explicitly
 */
export function localizedHref(path: string, lang: string): string;

/**
 * Implementation
 */
export function localizedHref(path: string, lang?: string): string {
	// Don't modify external URLs, anchors, or API routes
	if (
		path.startsWith('http://') ||
		path.startsWith('https://') ||
		path.startsWith('#') ||
		path.startsWith('/api/')
	) {
		return path;
	}

	// Use explicit lang if provided, otherwise read from page state
	const currentLang = lang ?? page.params.lang ?? DEFAULT_LANGUAGE;

	// Ensure path starts with /
	const cleanPath = path.startsWith('/') ? path : `/${path}`;

	return `/${currentLang}${cleanPath}`;
}
