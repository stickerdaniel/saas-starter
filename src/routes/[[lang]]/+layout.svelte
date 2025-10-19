<script lang="ts">
	import { Tolgee, DevTools, FormatSimple, TolgeeProvider } from '@tolgee/svelte';
	import { browser } from '$app/environment';
	import type { LayoutData } from './$types';
	import { watch } from 'runed';
	import { setLanguageContext } from '$lib/i18n/context';

	let { data, children }: { data: LayoutData; children: any } = $props();

	// Set language context with a function to maintain reactivity
	// This ensures useLanguage() always returns the current value of data.lang
	setLanguageContext(() => data.lang);

	const tolgee = Tolgee()
		.use(DevTools())
		.use(FormatSimple())
		.init({
			language: data.lang,
			apiUrl: import.meta.env.VITE_TOLGEE_API_URL,
			apiKey: import.meta.env.VITE_TOLGEE_API_KEY,

			// Fetch translations from Tolgee cloud
			availableLanguages: ['en', 'de', 'es', 'fr'],
			defaultLanguage: 'en',
			fallbackLanguage: 'en'
		});

	// Sync Tolgee language with URL parameter when user navigates (back/forward buttons)
	if (browser) {
		// Set initial HTML lang attribute
		document.documentElement.lang = data.lang;

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
	<div slot="fallback" class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
			<p class="mt-4 text-sm text-gray-600">Loading translations...</p>
		</div>
	</div>

	{@render children()}
</TolgeeProvider>
