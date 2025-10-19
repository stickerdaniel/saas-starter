import { error } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';
import { isSupportedLanguage, DEFAULT_LANGUAGE } from '$lib/i18n/languages';

export const load: LayoutLoad = async ({ params }) => {
	const lang = params.lang;

	// If no language parameter, use default
	if (!lang) {
		return {
			lang: DEFAULT_LANGUAGE
		};
	}

	// Validate language parameter
	if (!isSupportedLanguage(lang)) {
		const message = `Language '${String(lang)}' is not supported`;
		// eslint-disable-next-line @typescript-eslint/only-throw-error
		throw error(404, message);
	}

	return {
		lang
	};
};
