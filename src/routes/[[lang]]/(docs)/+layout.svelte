<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children?: Snippet } = $props();
</script>

<main id="main-content" class="min-h-svh-below-notices selectable">
	{@render children?.()}
</main>
