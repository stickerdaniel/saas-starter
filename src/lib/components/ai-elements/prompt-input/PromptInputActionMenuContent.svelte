<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	interface Props {
		class?: string;
		children?: Snippet;
	}

	let { class: className, children, ...props }: Props = $props();
</script>

<DropdownMenu.Content align="start" class={cn(className)} {...props}>
	{#if children}
		{@render children()}
	{/if}
</DropdownMenu.Content>
