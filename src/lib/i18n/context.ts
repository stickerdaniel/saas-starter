import { createContext } from 'svelte';

/**
 * Language context for sharing the current language across the component tree
 * The root layout provides a getter so descendants retain language reactivity.
 */
const [get, set] = createContext<() => string>();
export const languageContext = { get, set };

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
	const getLang = languageContext.get();
	// Call the function to get the current language value
	return getLang();
}
