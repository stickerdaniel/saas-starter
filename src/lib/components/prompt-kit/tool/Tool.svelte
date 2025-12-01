<script lang="ts">
	import { cn } from '$lib/utils';
	import { Collapsible } from '$lib/components/ui/collapsible/index.js';
	import type { ToolPart } from './types.js';
	import type { Snippet } from 'svelte';

	let {
		toolPart,
		defaultOpen = false,
		open = $bindable(defaultOpen),
		class: className,
		children
	}: {
		toolPart: ToolPart;
		defaultOpen?: boolean;
		open?: boolean;
		class?: string;
		children: Snippet<[ToolPart]>;
	} = $props();
</script>

<Collapsible
	bind:open
	class={cn('mt-3 overflow-hidden rounded-lg border border-border', className)}
>
	{@render children(toolPart)}
</Collapsible>
