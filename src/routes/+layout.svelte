<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { T, Tolgee, DevTools, TolgeeProvider } from '@tolgee/svelte';
	import type { TolgeeStaticData } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import { ModeWatcher } from 'mode-watcher';
	import AppAuthProvider from '$lib/components/app/app-auth-provider.svelte';
	import AppAutumnProvider from '$lib/components/app/app-autumn-provider.svelte';
	import AppPostHogBootstrap from '$lib/components/app/app-posthog-bootstrap.svelte';
	import { setGlobalSearchContext } from '$lib/components/global-search/context.svelte';
	import GlobalSearchShell from '$lib/components/global-search/global-search-shell.svelte';
	import { languageContext } from '$lib/i18n/context';
	import { getLanguage } from '$lib/i18n/languages';
	import RouteProgress from '$lib/components/RouteProgress.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { watch } from 'runed';
	import de from '../i18n/de.json';
	import en from '../i18n/en.json';
	import es from '../i18n/es.json';
	import fr from '../i18n/fr.json';
	import './layout.css';

	const translations: TolgeeStaticData = { en, de, es, fr };

	let { children } = $props();

	const currentLang = $derived(getLanguage(page.params.lang).code);

	languageContext.set(() => currentLang);
	setGlobalSearchContext();

	// Intentionally capture initial language; watch() syncs route changes below.
	// svelte-ignore state_referenced_locally
	const tolgee = Tolgee()
		.use(DevTools())
		.use(FormatIcu())
		.init({
			language: currentLang,

			staticData: translations,

			availableLanguages: ['en', 'de', 'es', 'fr'],
			defaultLanguage: 'en',
			fallbackLanguage: 'en',

			apiUrl: import.meta.env.VITE_TOLGEE_API_URL,
			apiKey: import.meta.env.VITE_TOLGEE_API_KEY
		});

	if (browser) {
		watch(
			() => currentLang,
			(newLang) => {
				if (tolgee.getLanguage() !== newLang) {
					tolgee.changeLanguage(newLang);
				}
			}
		);

		watch(
			() => currentLang,
			(newLang) => {
				document.documentElement.lang = newLang;
			}
		);
	}
</script>

<ModeWatcher />
<SEOHead />
<AppPostHogBootstrap />

<AppAuthProvider>
	<AppAutumnProvider>
		<Toaster />
		<RouteProgress />

		<Tooltip.Provider>
			<TolgeeProvider {tolgee}>
				<a
					href="#main-content"
					class="sr-only z-50 focus-visible:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:left-4 focus-visible:rounded-md focus-visible:bg-background focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					<T keyName="a11y.skip_to_content" />
				</a>
				<GlobalSearchShell />
				{@render children()}
			</TolgeeProvider>
		</Tooltip.Provider>
	</AppAutumnProvider>
</AppAuthProvider>
