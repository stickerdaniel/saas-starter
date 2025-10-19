/**
 * Supported languages configuration for i18n
 */

export interface Language {
	/** Language code (ISO 639-1) */
	code: string;
	/** Display name in the language itself (native name) */
	name: string;
	/** Display name in English */
	nameEn: string;
	/** Flag emoji */
	flag: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
	{
		code: 'en',
		name: 'English',
		nameEn: 'English',
		flag: '🇺🇸'
	},
	{
		code: 'de',
		name: 'Deutsch',
		nameEn: 'German',
		flag: '🇩🇪'
	},
	{
		code: 'es',
		name: 'Español',
		nameEn: 'Spanish',
		flag: '🇪🇸'
	},
	{
		code: 'fr',
		name: 'Français',
		nameEn: 'French',
		flag: '🇫🇷'
	}
];

/** Default language code */
export const DEFAULT_LANGUAGE = 'en';

/** Map of language codes for quick lookup */
export const LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map((lang) => lang.code));

/**
 * Check if a language code is supported
 */
export function isSupportedLanguage(code: string | undefined): code is string {
	return code !== undefined && LANGUAGE_CODES.has(code);
}

/**
 * Get language by code or return default
 */
export function getLanguage(code: string | undefined): Language {
	if (!code) {
		return SUPPORTED_LANGUAGES.find((lang) => lang.code === DEFAULT_LANGUAGE)!;
	}
	return SUPPORTED_LANGUAGES.find((lang) => lang.code === code) || SUPPORTED_LANGUAGES[0];
}
