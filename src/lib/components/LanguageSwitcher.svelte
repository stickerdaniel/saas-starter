<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { SUPPORTED_LANGUAGES } from '$lib/i18n/languages';
	import { LanguageSwitcher as LanguageSwitcherUI } from '$lib/components/ui/language-switcher';
	import type { LanguageSwitcherProps } from './ui/language-switcher/types';
	import { useLanguage } from '$lib/utils/i18n';

	interface Props {
		/** Button variant */
		variant?: 'outline' | 'ghost';
		/** Dropdown alignment */
		align?: 'start' | 'center' | 'end';
		/** Custom class */
		class?: string;
	}

	let { variant = 'outline', align = 'end', class: className }: Props = $props();

	// Get current language from context (reactive)
	let currentLanguage = $derived(useLanguage());

	// Map our language format to shadcn's expected format
	const languages: LanguageSwitcherProps['languages'] = SUPPORTED_LANGUAGES.map((lang) => ({
		code: lang.code,
		label: lang.name
	}));

	/**
	 * Switch to a new language
	 */
	function switchLanguage(newLang: string) {
		const currentPath = page.url.pathname;
		const currentLang = currentLanguage;

		// Replace language in current path
		let newPath: string;
		if (currentLang && currentPath.startsWith(`/${currentLang}`)) {
			newPath = currentPath.replace(`/${currentLang}`, `/${newLang}`);
		} else {
			// If no lang in path (shouldn't happen with [[lang]]), prepend new lang
			newPath = `/${newLang}${currentPath}`;
		}

		// Preserve search params
		const searchParams = page.url.search;
		goto(newPath + searchParams);
	}
</script>

<LanguageSwitcherUI
	{languages}
	value={currentLanguage}
	{variant}
	{align}
	onChange={switchLanguage}
	class={className}
/>
