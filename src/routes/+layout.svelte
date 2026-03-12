<script lang="ts">
	import { page } from '$app/state';
	import { createSvelteAuthClient } from '$lib/auth-svelte.svelte';
	import { ModeWatcher } from 'mode-watcher';
	import AppAutumnProvider from '$lib/components/app/app-autumn-provider.svelte';
	import AppPostHogBootstrap from '$lib/components/app/app-posthog-bootstrap.svelte';
	import RouteProgress from '$lib/components/RouteProgress.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { authClient } from '$lib/auth-client';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import './layout.css';

	let { children } = $props();

	createSvelteAuthClient({
		authClient,
		getServerState() {
			return page.data.authState;
		}
	});
</script>

<ModeWatcher />
<SEOHead />
<AppPostHogBootstrap />

<AppAutumnProvider>
	<Toaster />
	<RouteProgress />

	<Tooltip.Provider>
		{@render children()}
	</Tooltip.Provider>
</AppAutumnProvider>
