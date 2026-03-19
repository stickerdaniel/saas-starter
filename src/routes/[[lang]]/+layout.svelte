<script lang="ts">
	import { Tolgee, DevTools, TolgeeProvider } from '@tolgee/svelte';
	import type { TolgeeStaticData } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import { browser } from '$app/environment';
	import AppAuthOAuthBootstrap from '$lib/components/app/app-auth-oauth-bootstrap.svelte';
	import { setGlobalSearchContext } from '$lib/components/global-search/context.svelte';
	import GlobalSearchShell from '$lib/components/global-search/global-search-shell.svelte';
	import type { LayoutData } from './$types';
	import { watch } from 'runed';
	import { languageContext } from '$lib/i18n/context';
	import en from '../../i18n/en.json';
	import de from '../../i18n/de.json';
	import es from '../../i18n/es.json';
	import fr from '../../i18n/fr.json';

	// Eager imports so Tolgee's cache is populated at init, enabling SSR rendering
	const translations: TolgeeStaticData = { en, de, es, fr };

	import type { Snippet } from 'svelte';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Set language context with a function to maintain reactivity
	// This ensures useLanguage() always returns the current value of data.lang
	languageContext.set(() => data.lang);
	setGlobalSearchContext();

	// Intentionally capture initial language; watch() syncs URL navigation changes below.
	// svelte-ignore state_referenced_locally
	const tolgee = Tolgee()
		.use(DevTools())
		.use(FormatIcu())
		.init({
			language: data.lang,

			staticData: translations,

			availableLanguages: ['en', 'de', 'es', 'fr'],
			defaultLanguage: 'en',
			fallbackLanguage: 'en',

			// DevTools configuration (auto-removed in production builds)
			apiUrl: import.meta.env.VITE_TOLGEE_API_URL,
			apiKey: import.meta.env.VITE_TOLGEE_API_KEY
		});

	// Sync Tolgee language with URL parameter when user navigates (back/forward buttons)
	if (browser) {
		watch(
			() => data.lang,
			(newLang) => {
				if (tolgee.getLanguage() !== newLang) {
					tolgee.changeLanguage(newLang);
				}
			}
		);

		// Update HTML lang attribute when language changes
		watch(
			() => data.lang,
			(newLang) => {
				document.documentElement.lang = newLang;
			}
		);
	}
</script>

<TolgeeProvider {tolgee}>
	<AppAuthOAuthBootstrap />
	<GlobalSearchShell />
	{@render children()}
</TolgeeProvider>
