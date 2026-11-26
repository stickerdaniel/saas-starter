import { type Locale, de, es, fr } from 'date-fns/locale';

const dateFnsLocaleMap: Record<string, Locale> = { de, es, fr };

/**
 * Map a UI language code to a date-fns locale.
 * Returns undefined for 'en' and unknown codes (date-fns defaults to en-US).
 */
export function getDateFnsLocale(lang: string): Locale | undefined {
	return dateFnsLocaleMap[lang] ?? undefined;
}
