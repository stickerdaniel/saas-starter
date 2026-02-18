<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	type Props = {
		children?: Snippet;
	};

	let { children }: Props = $props();
</script>

{#key page.params.resource}
	{@render children?.()}
{/key}
