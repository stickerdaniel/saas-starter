<script lang="ts">
	import { browser } from '$app/environment';
	import { beforeNavigate, onNavigate } from '$app/navigation';
	import { page, updated } from '$app/state';
	import { T, Tolgee, DevTools, TolgeeProvider } from '@tolgee/svelte';
	import type { TolgeeStaticData } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import { ModeWatcher } from 'mode-watcher';
	import AppAuthProvider from '$lib/components/app/app-auth-provider.svelte';
	import AppAutumnProvider from '$lib/components/app/app-autumn-provider.svelte';
	import AppPostHogBootstrap from '$lib/components/app/app-posthog-bootstrap.svelte';
	import ClockSkewBanner from '$lib/components/clock-skew-banner.svelte';
	import { ClockSkewState, clockSkewContext } from '$lib/hooks/clock-skew.svelte';
	import { setGlobalSearchContext } from '$lib/components/global-search/context.svelte';
	import GlobalSearchShell from '$lib/components/global-search/global-search-shell.svelte';
	import { languageContext } from '$lib/i18n/context';
	import { getLanguage } from '$lib/i18n/languages';
	import RouteProgress from '$lib/components/RouteProgress.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { watch } from 'runed';
	import { devNotice } from '$lib/dev/notice';
	import de from '../i18n/de.json';
	import en from '../i18n/en.json';
	import es from '../i18n/es.json';
	import fr from '../i18n/fr.json';
	import './layout.css';

	const translations: TolgeeStaticData = { en, de, es, fr };

	let { children } = $props();

	// After a new deploy is detected (version.json poll flips updated.current),
	// turn the next client navigation into a full document load so fresh chunk
	// hashes are fetched instead of importing a now-deleted hash and blanking
	// the page. Covers goto() and back/forward, unlike data-sveltekit-reload.
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});

	// Fade page navigations via the View Transitions API (see layout.css).
	// Same-path navigations (table sort/pagination/search param churn) and
	// reduced motion stay instant. Rendering is frozen on the old snapshot
	// while the transition waits for the navigation, which would hide
	// RouteProgress on slow loads - so slow navigations bail out of the
	// transition and fall back to the progress bar.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (navigation.to?.url.pathname === navigation.from?.url.pathname) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		return new Promise((resolve) => {
			let completed = false;
			const transition = document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
				completed = true;
			});
			setTimeout(() => {
				if (!completed) transition.skipTransition();
			}, 250);
		});
	});

	// Detect a misconfigured device clock, which silently breaks cookie-based auth
	// (the browser drops freshly minted short-TTL auth cookies it thinks are
	// already expired). Shared via context so the banner and the authenticated
	// connection fallback can both explain it. Measured once, deferred after
	// hydration so it never blocks first paint.
	const clockSkew = new ClockSkewState();
	clockSkewContext.set(clockSkew);
	if (browser) {
		const measure = () => void clockSkew.measure();
		if ('requestIdleCallback' in window) {
			requestIdleCallback(measure, { timeout: 3000 });
		} else {
			setTimeout(measure, 1500);
		}
	}

	const currentLang = $derived(getLanguage(page.params.lang).code);

	languageContext.set(() => currentLang);
	setGlobalSearchContext();

	// Intentionally capture initial language; watch() syncs route changes below.
	const tolgeeBuilder = Tolgee().use(FormatIcu());
	if (import.meta.env.DEV) {
		tolgeeBuilder.use(DevTools());
		if (!import.meta.env.VITE_TOLGEE_API_KEY) {
			devNotice({
				feature: 'Tolgee in-context translation editing',
				missing: ['VITE_TOLGEE_API_KEY'],
				scope: 'vite-public'
			});
		}
	}
	// svelte-ignore state_referenced_locally
	const tolgee = tolgeeBuilder.init({
		language: currentLang,

		staticData: translations,

		availableLanguages: ['en', 'de', 'es', 'fr'],
		defaultLanguage: 'en',
		fallbackLanguage: 'en',

		// Live Tolgee (in-context editing) is dev-only. Production and preview
		// builds fold import.meta.env.DEV to false, so apiUrl/apiKey and their
		// inlined values are dead-code-eliminated: the shipped bundle runs purely
		// from staticData and never talks to the Tolgee server.
		apiUrl: import.meta.env.DEV ? import.meta.env.VITE_TOLGEE_API_URL : undefined,
		apiKey: import.meta.env.DEV ? import.meta.env.VITE_TOLGEE_API_KEY : undefined
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
				<ClockSkewBanner />
				<GlobalSearchShell />
				{@render children()}
			</TolgeeProvider>
		</Tooltip.Provider>
	</AppAutumnProvider>
</AppAuthProvider>
