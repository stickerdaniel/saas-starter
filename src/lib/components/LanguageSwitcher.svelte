<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SUPPORTED_LANGUAGES } from '$lib/i18n/languages';
	import { LanguageSwitcher as LanguageSwitcherUI } from '$lib/components/ui/language-switcher';
	import type { LanguageSwitcherProps } from './ui/language-switcher/types';
	import { useLanguage } from '$lib/utils/i18n';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { updateUserWithLocale } from '$lib/auth-client';

	interface Props {
		/** Button variant */
		variant?: 'outline' | 'ghost';
		/** Dropdown alignment */
		align?: 'start' | 'center' | 'end';
		/** Custom class */
		class?: string;
	}

	let { variant = 'outline', align = 'end', class: className }: Props = $props();

	const auth = useAuth();

	// Get current language from context (reactive)
	let currentLanguage = $derived(useLanguage());

	// Map our language format to shadcn's expected format
	const languages: LanguageSwitcherProps['languages'] = SUPPORTED_LANGUAGES.map((lang) => ({
		code: lang.code,
		label: lang.name
	}));

	/**
	 * Switch to a new language.
	 * Also persists the locale to the user's profile if authenticated.
	 */
	async function switchLanguage(newLang: string) {
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
		goto(resolve(newPath + searchParams));

		// Persist locale to user profile if authenticated
		if (auth.isAuthenticated) {
			try {
				await updateUserWithLocale({ locale: newLang });
			} catch {
				// Silently fail - URL change already happened, locale update is best-effort
				console.warn('Failed to persist locale preference to user profile');
			}
		}
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
