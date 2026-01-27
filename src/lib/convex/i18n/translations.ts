/**
 * Backend translation helper for Convex functions.
 * Imports the same JSON translation files used by the frontend Tolgee setup.
 *
 * Usage:
 *   import { t, extractLocaleFromUrl } from './i18n/translations';
 *
 *   // Translate a key with the user's locale
 *   const message = t(userLocale, 'backend.support.handoff.response');
 *
 *   // With parameters
 *   const message = t(locale, 'settings.account.avatar.size_error', { size: '2MB' });
 *
 *   // Extract locale from a URL path
 *   const locale = extractLocaleFromUrl('/de/app/settings'); // returns 'de'
 */

import en from '../../../i18n/en.json';
import de from '../../../i18n/de.json';
import es from '../../../i18n/es.json';
import fr from '../../../i18n/fr.json';

/** Supported locales */
export const SUPPORTED_LOCALES = ['en', 'de', 'es', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Default locale used as fallback */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** Translation data indexed by locale */
const translations: Record<SupportedLocale, Record<string, unknown>> = {
	en,
	de,
	es,
	fr
};

/**
 * Get a nested value from an object using dot notation path.
 * Example: getNestedValue(obj, 'admin.actions.ban') returns obj.admin.actions.ban
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
	const result = path.split('.').reduce<unknown>((current, key) => {
		if (current && typeof current === 'object' && key in current) {
			return (current as Record<string, unknown>)[key];
		}
		return undefined;
	}, obj);

	return typeof result === 'string' ? result : undefined;
}

/**
 * Translate a key to the specified locale with optional parameter interpolation.
 *
 * @param locale - The target locale (e.g., 'en', 'de', 'es', 'fr')
 * @param key - The translation key in dot notation (e.g., 'admin.actions.ban')
 * @param params - Optional parameters to interpolate into the string
 * @returns The translated string, or the key itself if not found
 *
 * @example
 * t('de', 'admin.dialog.ban_description', { email: 'user@example.com' })
 * // Returns: "Möchten Sie user@example.com wirklich sperren? Der Zugriff auf die App wird blockiert."
 */
export function t(
	locale: string | null | undefined,
	key: string,
	params?: Record<string, string | number>
): string {
	const effectiveLocale = getValidLocale(locale);
	const langData = translations[effectiveLocale];

	// Try to get the translation, fallback to English, then to the key itself
	let text =
		getNestedValue(langData, key) ?? getNestedValue(translations[DEFAULT_LOCALE], key) ?? key;

	// Interpolate parameters using {paramName} syntax
	if (params) {
		Object.entries(params).forEach(([paramKey, value]) => {
			text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
		});
	}

	return text;
}

/**
 * Extract locale from a URL path.
 * Looks for a supported locale code at the start of the path.
 *
 * @param url - The URL or path to extract locale from
 * @returns The extracted locale or the default locale if not found
 *
 * @example
 * extractLocaleFromUrl('/de/app/settings') // returns 'de'
 * extractLocaleFromUrl('https://example.com/fr/support') // returns 'fr'
 * extractLocaleFromUrl('/app/settings') // returns 'en' (default)
 */
export function extractLocaleFromUrl(url: string | null | undefined): SupportedLocale {
	if (!url) return DEFAULT_LOCALE;

	try {
		// Handle full URLs by extracting the pathname
		let pathname: string;
		if (url.startsWith('http://') || url.startsWith('https://')) {
			pathname = new URL(url).pathname;
		} else {
			pathname = url;
		}

		// Extract the first path segment after the leading slash
		const match = pathname.match(/^\/([a-z]{2})(?:\/|$)/i);
		if (match) {
			const potentialLocale = match[1].toLowerCase();
			if (SUPPORTED_LOCALES.includes(potentialLocale as SupportedLocale)) {
				return potentialLocale as SupportedLocale;
			}
		}
	} catch {
		// URL parsing failed, return default
	}

	return DEFAULT_LOCALE;
}

/**
 * Check if a locale is supported.
 */
export function isSupportedLocale(locale: string | null | undefined): locale is SupportedLocale {
	return typeof locale === 'string' && SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

/**
 * Get a valid locale, falling back to default if invalid.
 */
export function getValidLocale(locale: string | null | undefined): SupportedLocale {
	return isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
}
