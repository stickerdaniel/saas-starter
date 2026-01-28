<script lang="ts">
	import { createSvelteAuthClient, useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { setupAutumn } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { api } from '$lib/convex/_generated/api';
	import './layout.css';
	import { navigating } from '$app/stores';
	import { invalidate } from '$app/navigation';
	import { expoOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { browser } from '$app/environment';
	import { useConvexClient } from 'convex-svelte';
	import { isAnonymousUser } from '$lib/convex/utils/anonymousUser';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';

	let { children, data } = $props();

	// Deferred PostHog initialization - loads after initial render
	onMount(() => {
		const POSTHOG_INIT_DELAY_MS = 100;
		const ADBLOCK_DETECT_TIMEOUT_MS = 3000;

		// Detect if PostHog is blocked by ad-blocker or network issues
		async function detectAdBlock(host: string): Promise<boolean> {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), ADBLOCK_DETECT_TIMEOUT_MS);

				await fetch(`${host}/static/array.js`, {
					method: 'GET',
					mode: 'no-cors',
					cache: 'no-store',
					signal: controller.signal
				});

				clearTimeout(timeoutId);
				return false; // Request succeeded = not blocked
			} catch {
				return true; // Blocked, timeout, or network error
			}
		}

		const timer = setTimeout(async () => {
			const PUBLIC_POSTHOG_API_KEY = env.PUBLIC_POSTHOG_API_KEY;
			const PUBLIC_POSTHOG_HOST = env.PUBLIC_POSTHOG_HOST;

			if (!PUBLIC_POSTHOG_API_KEY || !PUBLIC_POSTHOG_HOST) return;

			try {
				// Dynamic import - only loads when needed
				const posthog = (await import('posthog-js')).default;

				const proxyHost = env.PUBLIC_POSTHOG_PROXY_HOST;
				const isBlocked = await detectAdBlock(PUBLIC_POSTHOG_HOST);
				const apiHost = isBlocked ? proxyHost || PUBLIC_POSTHOG_HOST : PUBLIC_POSTHOG_HOST;

				posthog.init(PUBLIC_POSTHOG_API_KEY, {
					api_host: apiHost,
					ui_host: 'https://eu.posthog.com',
					person_profiles: 'identified_only'
				});
			} catch (e) {
				if (import.meta.env.DEV) {
					console.warn('PostHog initialization failed:', e);
				}
			}
		}, POSTHOG_INIT_DELAY_MS);

		return () => clearTimeout(timer);
	});

	// Initialize Better Auth client
	createSvelteAuthClient({
		authClient,
		getServerState: () => data.authState
	});

	const auth = useAuth();

	// Setup Autumn with SSR support and auto-invalidation
	setupAutumn({
		convexApi: (api as any).autumn,
		getServerState: () => data.autumnState,
		invalidate
	});

	// Migrate anonymous support tickets to authenticated user
	const convexClient = useConvexClient();
	let migrationAttempted = false;

	$effect(() => {
		if (!browser || !data.viewer || migrationAttempted) return;
		if (auth.isLoading || !auth.isAuthenticated) return;

		const anonymousId = localStorage.getItem('supportUserId');
		if (!anonymousId || !isAnonymousUser(anonymousId)) return;

		migrationAttempted = true;
		convexClient
			.mutation(api.support.migration.migrateAnonymousTickets, {
				anonymousUserId: anonymousId
			})
			.then(() => {
				localStorage.removeItem('supportUserId');
			})
			.catch((err: unknown) => {
				console.error('Failed to migrate anonymous tickets:', err);
				migrationAttempted = false; // Allow retry on next navigation
			});
	});
</script>

<ModeWatcher />
<SEOHead />
<PostHogIdentify />
<Toaster />

<Tooltip.Provider>
	{#if $navigating}
		<!--
			Loading animation for next page since SvelteKit doesn't show any indicator.
			- delay 100ms because most page loads are instant, and we don't want to flash
			- long 12s duration because we don't actually know how long it will take
			- exponential easing so fast loads (>100ms and <1s) still see enough progress,
			  while slow networks see it moving for a full 12 seconds
		-->
		<div
			class="fixed top-0 right-0 left-0 z-50 h-1 w-full bg-primary"
			in:slide={{ delay: 100, duration: 12000, axis: 'x', easing: expoOut }}
		></div>
	{/if}
	{@render children()}
</Tooltip.Provider>
