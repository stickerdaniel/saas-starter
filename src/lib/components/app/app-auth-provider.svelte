<script lang="ts">
	import { page } from '$app/state';
	import { invalidate } from '$app/navigation';
	import { browser } from '$app/environment';
	import { createSvelteAuthClient, useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';

	let { children } = $props();

	createSvelteAuthClient({
		authClient,
		getServerState() {
			return page.data.authState;
		}
	});

	const auth = useAuth();

	// Track the auth value we last invalidated for, so the effect fires once per
	// divergence instead of looping. Plain let (not $state): the effect must read
	// it without depending on it, and write it without re-triggering itself.
	let lastInvalidatedAuth: boolean | undefined;

	// Sync server layout data when client auth state diverges.
	// Prerendered pages bake authState.isAuthenticated: false at build time.
	// When the client recovers a session from cookies, the server's root layout
	// data (viewer, autumnState) remains stale. This invalidation triggers a
	// re-run of the root +layout.server.ts with fresh cookies, so navigating
	// to /app has the correct viewer data instead of null.
	//
	// On a truly prerendered page the re-run returns the frozen build-time data,
	// so the divergence never clears. Without the per-value guard the effect
	// would re-fire invalidate on every resulting page.data change — a loop that
	// repeatedly calls client.setAuth() and re-pauses the Convex WebSocket,
	// leaving auth-gated queries (e.g. the support widget's thread list) stuck
	// loading. Invalidate at most once per client-auth transition.
	$effect(() => {
		if (!browser || auth.isLoading) return;

		const clientAuth = auth.isAuthenticated;
		const serverAuth = page.data.authState?.isAuthenticated ?? false;
		if (clientAuth !== serverAuth && lastInvalidatedAuth !== clientAuth) {
			lastInvalidatedAuth = clientAuth;
			invalidate('app:auth');
		}
	});
</script>

{@render children()}
