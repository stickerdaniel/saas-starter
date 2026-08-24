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
	// Public pages can carry a local JWT snapshot while authenticated routes
	// resolve full backend data. When client auth diverges, invalidate the root
	// snapshot so later navigation receives current session state.
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
