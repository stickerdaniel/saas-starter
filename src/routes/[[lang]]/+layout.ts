import { error } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';
import { isSupportedLanguage, DEFAULT_LANGUAGE } from '$lib/i18n/languages';
import type { TolgeeStaticData } from '@tolgee/svelte';
import en from '../../i18n/en.json';
import de from '../../i18n/de.json';
import es from '../../i18n/es.json';
import fr from '../../i18n/fr.json';

// Eager imports so Tolgee's cache is populated at init, enabling SSR rendering
const translations: TolgeeStaticData = { en, de, es, fr };

export const load: LayoutLoad = async ({ params, parent }) => {
	const parentData = await parent();
	const lang = params.lang;

	// If no language parameter, use default
	if (!lang) {
		return {
			...parentData,
			lang: DEFAULT_LANGUAGE,
			translations
		};
	}

	// Validate language parameter
	if (!isSupportedLanguage(lang)) {
		const message = `Language '${String(lang)}' is not supported`;
		throw error(404, message);
	}

	return {
		...parentData,
		lang,
		translations
	};
};
