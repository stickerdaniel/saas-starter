<script lang="ts">
	import { page } from '$app/state';
	import { createSvelteAuthClient, useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { commitOAuthSuccessIfPending } from '$lib/hooks/last-auth-method.svelte';

	let { children } = $props();

	createSvelteAuthClient({
		authClient,
		getServerState() {
			return page.data.authState;
		}
	});

	const auth = useAuth();

	$effect(function commitPendingOAuthMethodEffect() {
		if (auth.isLoading || !auth.isAuthenticated) return;
		commitOAuthSuccessIfPending();
	});
</script>

{@render children()}
