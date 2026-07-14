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
	/** Open Graph locale in language_TERRITORY format (e.g. "en_US") */
	ogLocale: string;
}

export const SUPPORTED_LANGUAGES = [
	{
		code: 'en',
		name: 'English',
		nameEn: 'English',
		flag: '🇺🇸',
		ogLocale: 'en_US'
	},
	{
		code: 'de',
		name: 'Deutsch',
		nameEn: 'German',
		flag: '🇩🇪',
		ogLocale: 'de_DE'
	},
	{
		code: 'es',
		name: 'Español',
		nameEn: 'Spanish',
		flag: '🇪🇸',
		ogLocale: 'es_ES'
	},
	{
		code: 'fr',
		name: 'Français',
		nameEn: 'French',
		flag: '🇫🇷',
		ogLocale: 'fr_FR'
	}
] as const satisfies readonly Language[];

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/** Default language code */
export const DEFAULT_LANGUAGE = 'en' as const satisfies LanguageCode;

/** Cookie that remembers an explicit language choice for bare/prefixless paths */
export const LANGUAGE_COOKIE_NAME = 'lang_pref';
/** Language preference cookie lifetime (~1 year) */
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Map of language codes for quick lookup */
export const LANGUAGE_CODES = new Set<LanguageCode>(SUPPORTED_LANGUAGES.map((lang) => lang.code));

/**
 * Check if a language code is supported
 */
export function isSupportedLanguage(code: string | undefined): code is LanguageCode {
	return code !== undefined && LANGUAGE_CODES.has(code as LanguageCode);
}

/**
 * Get language by code or return default
 */
export function getLanguage(code: string | undefined): Language {
	if (!code) {
		return SUPPORTED_LANGUAGES.find((lang) => lang.code === DEFAULT_LANGUAGE)!;
	}
	return SUPPORTED_LANGUAGES.find((lang) => lang.code === code) ?? SUPPORTED_LANGUAGES[0]!;
}
