<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { setupAutumn } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
	import { api } from '#lib/convex/_generated/api.js';
	import { toAutumnClientApi } from '#lib/billing/autumn-api-adapter.js';

	let { children } = $props();

	setupAutumn({
		convexApi: toAutumnClientApi(api.autumn),
		getServerState() {
			return page.data.autumnState;
		},
		invalidate
	});
</script>

{@render children()}
