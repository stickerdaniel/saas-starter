<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { setupAutumn } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { api } from '$lib/convex/_generated/api';

	let { children } = $props();

	setupAutumn({
		convexApi: (api as any).autumn,
		getServerState() {
			return page.data.autumnState;
		},
		invalidate
	});
</script>

{@render children()}
