<script lang="ts">
	import { browser, dev } from '$app/environment';
	import { beforeNavigate, onNavigate } from '$app/navigation';
	import { page, updated } from '$app/state';
	import { T, Tolgee, DevTools, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import { ModeWatcher } from 'mode-watcher';
	import AppAuthProvider from '$lib/components/app/app-auth-provider.svelte';
	import AppAutumnProvider from '$lib/components/app/app-autumn-provider.svelte';
	import AnalyticsRoot from '$lib/components/analytics/analytics-root.svelte';
	import {
		AnalyticsPreferences,
		analyticsPreferencesContext
	} from '$lib/analytics/preferences.svelte.ts';
	import ClockSkewBanner from '$lib/components/clock-skew-banner.svelte';
	import { ClockSkewState, clockSkewContext } from '$lib/hooks/clock-skew.svelte.ts';
	import InvestigationBar from '$lib/components/authenticated/investigation-bar.svelte';
	import { ImpersonationState, impersonationContext } from '$lib/hooks/use-impersonation.svelte.ts';
	import {
		ActiveUploads,
		activeUploadsContext,
		shouldBlockNavigation,
		deployReloadTarget
	} from '$lib/hooks/active-uploads.svelte.ts';
	import UploadGuardNotice from '$lib/components/upload-guard-notice.svelte';
	import CheckoutProvider from '$lib/components/billing/checkout-provider.svelte';
	import { setGlobalSearchContext } from '$lib/components/global-search/context.svelte.ts';
	import GlobalSearchShell from '$lib/components/global-search/global-search-shell.svelte';
	import { languageContext } from '$lib/i18n/context';
	import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '$lib/i18n/languages';
	import { routeLanguage } from '$lib/i18n/load-translations';
	import { FALLBACK_TRANSLATIONS } from '$lib/i18n/browser-translations.generated';
	import type { LayoutProps } from './$types';
	import RouteProgress from '$lib/components/RouteProgress.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { watch } from 'runed';
	import { devNotice } from '$lib/dev/notice';
	import { preloads } from 'fontless/runtime';
	import './layout.css';

	// Dev transforms can register the same font for several stylesheets.
	const fontPreloadHrefs = $derived(
		!dev && page.route.id === '/[[lang]]/(marketing)'
			? []
			: [...new Set(preloads.map(({ href }) => href))]
	);

	let { data, children }: LayoutProps = $props();

	// A file still transferring dies with the page, and silently: the progress bar
	// disappears and the user assumes it arrived. Ask first.
	//
	// This shares the deploy hook's callback on purpose. Cancelling a navigation
	// does not stop the other beforeNavigate callbacks, so a separate hook would
	// still let the reload below tear the upload down.
	const activeUploads = new ActiveUploads();
	activeUploadsContext.set(activeUploads);

	// One owner for every impersonation control, so the bar, the user menu and
	// the marketing header cannot start two exits at once.
	const impersonation = new ImpersonationState(activeUploads);
	impersonationContext.set(impersonation);

	/**
	 * Publish the notices' height so full-height shells shrink by it instead of
	 * pushing their bottom edge below the viewport.
	 */
	function measureTopNotices(node: HTMLElement) {
		const root = document.documentElement;
		let frame = 0;
		const observer = new ResizeObserver(() => {
			// Written on the next frame: resizing the shells from inside this callback
			// would resize elements other observers watch in the same delivery, which
			// the browser reports as a "ResizeObserver loop" error.
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				root.style.setProperty('--top-notices-height', `${node.getBoundingClientRect().height}px`);
			});
		});
		observer.observe(node);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			root.style.removeProperty('--top-notices-height');
		};
	}

	// After a new deploy is detected (version.json poll flips updated.current),
	// turn the next client navigation into a full document load so fresh chunk
	// hashes are fetched instead of importing a now-deleted hash and blanking
	// the page. Covers goto() and back/forward, unlike data-sveltekit-reload.
	beforeNavigate((nav) => {
		const exempt = activeUploads.consumeSuspension();
		if (!exempt && shouldBlockNavigation(nav, activeUploads.any)) {
			nav.cancel();
			// Leaving the document: SvelteKit turns the cancel into the browser's own
			// prompt, which says everything there is to say. Only a stopped in-app
			// navigation needs explaining, because nothing visibly happened.
			if (nav.to) activeUploads.noteBlocked();
			return;
		}
		const reloadTarget = deployReloadTarget(nav, updated.current, activeUploads.any);
		if (reloadTarget) {
			location.href = reloadTarget.href;
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

	const currentLang = $derived(
		data?.translationLanguage ?? routeLanguage(page.params.lang, page.url.pathname)
	);

	languageContext.set(() => currentLang);
	setGlobalSearchContext();
	analyticsPreferencesContext.set(new AnalyticsPreferences());

	// Live Tolgee (in-context editing) is dev-only. Production and preview builds
	// fold import.meta.env.DEV to false, so DevTools, apiUrl/apiKey and their
	// inlined values are dead-code-eliminated: the shipped bundle runs purely from
	// staticData and never talks to the Tolgee server. Local E2E (`dev:test`) is a
	// dev server too, but must render the same checked-in copy on every load.
	const liveTolgee = import.meta.env.DEV && import.meta.env.VITE_LOCAL_E2E_RUNTIME !== '1';

	// Intentionally capture initial language; watch() syncs route changes below.
	const tolgeeBuilder = Tolgee().use(FormatIcu());
	if (liveTolgee) {
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
		language: data?.translations ? currentLang : DEFAULT_LANGUAGE,

		// Root error pages can render without successful layout data.
		staticData: data?.translations ?? FALLBACK_TRANSLATIONS,

		availableLanguages: SUPPORTED_LANGUAGES.map((language) => language.code),
		defaultLanguage: DEFAULT_LANGUAGE,
		fallbackLanguage: DEFAULT_LANGUAGE,

		apiUrl: liveTolgee ? import.meta.env.VITE_TOLGEE_API_URL : undefined,
		apiKey: liveTolgee ? import.meta.env.VITE_TOLGEE_API_KEY : undefined
	});

	if (browser) {
		watch.pre(
			() => [currentLang, data?.translations] as const,
			([newLang, translations]) => {
				if (!translations) return;
				tolgee.addStaticData(translations);
				if (tolgee.getLanguage() !== newLang) {
					void tolgee.changeLanguage(newLang).catch((error) => {
						console.error('Failed to change language', error);
					});
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

<svelte:head>
	{#each fontPreloadHrefs as href (href)}
		<!-- Explicit attributes avoid Svelte's CSP-incompatible link spread handlers. -->
		<link rel="preload" as="font" {href} crossorigin="" />
	{/each}
</svelte:head>

<!-- synchronousModeChanges keeps the root class write out of a requestAnimationFrame,
	so the theme toggle's view transition captures the new theme rather than the one it
	replaced. See src/lib/components/ui/light-switch/theme-reveal.ts.
	disableHeadScriptInjection: src/app.html runs the initial-mode script, so its CSP hash
	is derived from the template. Keep that script's config aligned with these props. -->
<ModeWatcher disableHeadScriptInjection synchronousModeChanges />

<AppAuthProvider>
	<AppAutumnProvider>
		<Toaster />
		<RouteProgress />

		<Tooltip.Provider>
			<TolgeeProvider {tolgee}>
				<a
					href="#main-content"
					class="sr-only z-70 focus-visible:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:left-4 focus-visible:rounded-md focus-visible:bg-background focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					<T keyName="a11y.skip_to_content" />
				</a>
				<!-- Above the marketing header, which is fixed at z-40; the focused skip link
				     above sits higher still. -->
				<div class="sticky top-0 z-60" {@attach measureTopNotices}>
					<ClockSkewBanner />
					<InvestigationBar />
				</div>
				<UploadGuardNotice />
				<AnalyticsRoot />
				<GlobalSearchShell />
				<CheckoutProvider>
					{@render children()}
				</CheckoutProvider>
			</TolgeeProvider>
		</Tooltip.Provider>
	</AppAutumnProvider>
</AppAuthProvider>
