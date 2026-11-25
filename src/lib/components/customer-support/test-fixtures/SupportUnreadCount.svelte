<script lang="ts">
	import type { ConvexClient } from 'convex/browser';
	import { setConvexClientContext } from 'convex-svelte';
	import { useSupportUnreadState } from '../support-unread-state.svelte.ts';

	let { client }: { client: ConvexClient } = $props();

	// The client is fixed for the mounted test instance.
	// svelte-ignore state_referenced_locally
	setConvexClientContext(client);
	const unread = useSupportUnreadState();
</script>

<output>{unread.count}</output>
