<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	import type { Snippet } from 'svelte';
	interface Props {
		open?: boolean;
		children?: Snippet;
	}

	let { open = $bindable(false), children, ...props }: Props = $props();
</script>

<DropdownMenu.Root bind:open {...props}>
	{#if children}
		{@render children()}
	{/if}
</DropdownMenu.Root>
