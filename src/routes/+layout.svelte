<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import AppAuthProvider from '$lib/components/app/app-auth-provider.svelte';
	import AppAutumnProvider from '$lib/components/app/app-autumn-provider.svelte';
	import AppPostHogBootstrap from '$lib/components/app/app-posthog-bootstrap.svelte';
	import PostHogIdentify from '$lib/components/analytics/PostHogIdentify.svelte';
	import SupportTicketMigrationBootstrap from '$lib/components/customer-support/support-ticket-migration-bootstrap.svelte';
	import RouteProgress from '$lib/components/RouteProgress.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import './layout.css';

	let { children } = $props();
</script>

<ModeWatcher />
<SEOHead />
<AppPostHogBootstrap />

<AppAuthProvider>
	<PostHogIdentify />
	<SupportTicketMigrationBootstrap />

	<AppAutumnProvider>
		<Toaster />
		<RouteProgress />

		<Tooltip.Provider>
			{@render children()}
		</Tooltip.Provider>
	</AppAutumnProvider>
</AppAuthProvider>
