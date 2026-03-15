import { error } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';
import { isSupportedLanguage, DEFAULT_LANGUAGE } from '$lib/i18n/languages';

export const load: LayoutLoad = async ({ params, parent }) => {
	const parentData = await parent();
	const lang = params.lang;

	// If no language parameter, use default
	if (!lang) {
		return {
			...parentData,
			lang: DEFAULT_LANGUAGE
		};
	}

	// Validate language parameter
	if (!isSupportedLanguage(lang)) {
		const message = `Language '${String(lang)}' is not supported`;
		throw error(404, message);
	}

	return {
		...parentData,
		lang
	};
};
