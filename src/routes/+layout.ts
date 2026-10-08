// src/routes/+layout.ts
import type { LayoutLoad } from './$types';
import { loadTranslations, routeLanguage } from '#lib/i18n/load-translations.js';

export const load: LayoutLoad = async ({ data, params, url, fetch }) => {
	// Tolgee must have concrete catalogs before its provider renders on the server.
	const translationLanguage = routeLanguage(params.lang, url.pathname);
	return {
		...data,
		translationLanguage,
		translations: await loadTranslations(translationLanguage, fetch)
	};
};
