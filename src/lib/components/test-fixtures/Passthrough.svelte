<!-- Stands in for a provider or shell component: renders its children and nothing else. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
