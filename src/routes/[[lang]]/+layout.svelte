<script lang="ts">
	import { Tolgee, DevTools, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import { browser } from '$app/environment';
	import CommandMenu from '$lib/components/global-search/command-menu.svelte';
	import { setGlobalSearchContext } from '$lib/components/global-search/context.svelte';
	import type { LayoutData } from './$types';
	import { watch } from 'runed';
	import { languageContext } from '$lib/i18n/context';

	let { data, children }: { data: LayoutData; children: any } = $props();

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

			// Production: Use static translations bundled at build-time (pulled via CLI)
			// Development: DevTools can still use API key if VITE_TOLGEE_API_KEY is set
			staticData: {
				en: () => import('../../i18n/en.json'),
				de: () => import('../../i18n/de.json'),
				es: () => import('../../i18n/es.json'),
				fr: () => import('../../i18n/fr.json')
			},

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
	<CommandMenu />
	{@render children()}
</TolgeeProvider>
