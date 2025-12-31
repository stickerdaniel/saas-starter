import { Context } from 'runed';
import { DEFAULT_LANGUAGE } from './languages';

/**
 * Language context for sharing the current language across the component tree
 * Uses Runed's type-safe Context with a function to maintain reactivity
 */
export const languageContext = new Context<() => string>('language');

/**
 * Get the current language from context
 *
 * @returns The current language code (e.g., 'en', 'de', 'es', 'fr')
 * @throws Error if used outside of a component with language context
 *
 * @example
 * ```svelte
 * <script>
 *   import { useLanguage } from '$lib/utils/i18n';
 *
 *   const lang = useLanguage();
 *   console.log(lang); // 'es'
 * </script>
 * ```
 */
export function useLanguage(): string {
	const getLang = languageContext.getOr(() => DEFAULT_LANGUAGE);
	// Call the function to get the current language value
	return getLang();
}
