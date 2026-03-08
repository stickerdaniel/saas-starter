<script lang="ts">
	import { page } from '$app/state';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';

	let { children } = $props();

	createSvelteAuthClient({
		authClient,
		getServerState() {
			return page.data.authState;
		}
	});
</script>

{@render children()}
