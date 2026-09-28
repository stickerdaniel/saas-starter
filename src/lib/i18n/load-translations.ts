import type { TolgeeStaticData } from '@tolgee/svelte';
import { browser } from '$app/environment';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from './languages';
import { FALLBACK_TRANSLATIONS, TRANSLATION_URLS } from './browser-translations.generated';

const catalogs = new Map<string, Promise<Record<string, unknown>>>();

export function routeLanguage(language: string | undefined, pathname: string) {
	const candidate = language ?? pathname.split('/')[1];
	return isSupportedLanguage(candidate) ? candidate : DEFAULT_LANGUAGE;
}

export async function loadTranslations(
	language: string | undefined,
	fetchCatalog: typeof fetch = fetch
): Promise<TolgeeStaticData> {
	const locale = isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;
	if (locale === DEFAULT_LANGUAGE) return FALLBACK_TRANSLATIONS;
	let pending = browser ? catalogs.get(locale) : undefined;
	if (!pending) {
		// JSON asset fetches cannot trigger Vite's page-reloading import-error backstop.
		pending = fetchCatalog(TRANSLATION_URLS[locale])
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`Failed to load ${locale} translations (${response.status})`);
				return (await response.json()) as Record<string, unknown>;
			})
			.catch((error) => {
				catalogs.delete(locale);
				throw error;
			});
		// SSR must use each request's fetch so Kit can inline its response for hydration.
		if (browser) catalogs.set(locale, pending);
	}
	return { ...FALLBACK_TRANSLATIONS, [locale]: await pending };
}

export async function preloadTranslations(language: string): Promise<void> {
	// A speculative download must not interrupt the menu. Navigation owns load errors.
	await loadTranslations(language).catch(() => {});
}
