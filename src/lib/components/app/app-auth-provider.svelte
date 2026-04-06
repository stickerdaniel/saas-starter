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

	// Sync server layout data when client auth state diverges.
	// Prerendered pages bake authState.isAuthenticated: false at build time.
	// When the client recovers a session from cookies, the server's root layout
	// data (viewer, autumnState) remains stale. This invalidation triggers a
	// re-run of the root +layout.server.ts with fresh cookies, so navigating
	// to /app has the correct viewer data instead of null.
	$effect(() => {
		if (!browser || auth.isLoading) return;

		const serverAuth = page.data.authState?.isAuthenticated ?? false;
		if (auth.isAuthenticated !== serverAuth) {
			invalidate('app:auth');
		}
	});
</script>

{@render children()}
