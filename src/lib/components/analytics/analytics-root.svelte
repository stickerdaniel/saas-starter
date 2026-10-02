<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import {
		PUBLIC_POSTHOG_ALLOWED_HOSTS,
		PUBLIC_POSTHOG_API_KEY,
		PUBLIC_POSTHOG_HOST
	} from '$env/static/public';
	import { authClient } from '$lib/auth-client';
	import { setAnalyticsController } from '$lib/analytics/client';
	import { resolveAnalyticsConfig } from '$lib/analytics/config';
	import { AnalyticsController } from '$lib/analytics/controller';
	import { loadPosthog } from '$lib/analytics/posthog';
	import { followSession } from '$lib/analytics/session';
	import { analyticsPreferencesContext } from '$lib/analytics/preferences.svelte.ts';
	import { devNotice } from '$lib/dev/notice';
	import AnalyticsConsentBanner from './analytics-consent-banner.svelte';

	const preferences = analyticsPreferencesContext.get();
	let controller: AnalyticsController | undefined;

	function storage(name: 'localStorage' | 'sessionStorage'): Storage | undefined {
		try {
			return window[name];
		} catch {
			// Reading the property throws when the browser blocks site data.
			return undefined;
		}
	}

	function applyRoute(): void {
		controller?.setRoute(page.route.id, page.url.pathname, page.status < 400);
	}

	onMount(() => {
		const config = resolveAnalyticsConfig(
			{
				apiKey: PUBLIC_POSTHOG_API_KEY,
				apiHost: PUBLIC_POSTHOG_HOST,
				allowedHosts: PUBLIC_POSTHOG_ALLOWED_HOSTS
			},
			location.hostname
		);
		if (!config.enabled) {
			devNotice({
				feature: 'Product analytics (PostHog)',
				missing:
					config.reason === 'unconfigured'
						? ['PUBLIC_POSTHOG_API_KEY', 'PUBLIC_POSTHOG_HOST', 'PUBLIC_POSTHOG_ALLOWED_HOSTS']
						: config.reason === 'invalid_host'
							? ['PUBLIC_POSTHOG_HOST']
							: ['PUBLIC_POSTHOG_ALLOWED_HOSTS'],
				scope: 'vite-public',
				docs: 'docs/setup/analytics/posthog.md'
			});
			return;
		}

		// Carries no decision, only a hint to re-read the cookie.
		const channel = 'BroadcastChannel' in window ? new BroadcastChannel('analytics-consent') : null;
		const idle = window.requestIdleCallback?.bind(window);
		controller = new AnalyticsController({
			config,
			stores: {
				localStorage: storage('localStorage'),
				sessionStorage: storage('sessionStorage'),
				document,
				hostname: location.hostname,
				secure: location.protocol === 'https:'
			},
			getLocalStorage: () => storage('localStorage'),
			getSessionStorage: () => storage('sessionStorage'),
			cookies: {
				read: () => document.cookie,
				write: (cookie) => {
					document.cookie = cookie;
				}
			},
			loadSdk: loadPosthog,
			scheduleIdle: (task) => {
				if (idle) {
					const id = idle(task, { timeout: 3000 });
					return () => window.cancelIdleCallback(id);
				}
				const id = window.setTimeout(task, 1500);
				return () => window.clearTimeout(id);
			},
			setTimer: (task, ms) => {
				const id = window.setTimeout(task, ms);
				return () => window.clearTimeout(id);
			},
			nowSeconds: () => Math.floor(Date.now() / 1000),
			location: () => window.location,
			notifyOtherTabs: () => channel?.postMessage('changed')
		});
		const current = controller;
		const detach = preferences.attach(current);
		setAnalyticsController(current);
		if (channel) channel.onmessage = () => current.reconcile();
		// Subscribed for as long as analytics is configured, not only after consent: an
		// auth change that starts before a grant must still see its session resolve.
		const unsubscribeSession = followSession(current, authClient);
		applyRoute();
		current.start();

		return () => {
			unsubscribeSession();
			channel?.close();
			detach();
			current.dispose();
			setAnalyticsController(undefined);
			controller = undefined;
		};
	});

	afterNavigate(applyRoute);
</script>

<svelte:document onvisibilitychange={() => controller?.reconcile()} />
<svelte:window
	onpageshow={(event) => {
		if (event.persisted) controller?.pageRestored();
	}}
/>

<AnalyticsConsentBanner />
