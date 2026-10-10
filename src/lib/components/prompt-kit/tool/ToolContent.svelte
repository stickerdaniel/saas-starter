<script lang="ts">
	import { cn } from '#lib/utils.js';
	import { CollapsibleContent } from '#lib/components/ui/collapsible/index.js';
	import type { Snippet } from 'svelte';

	let {
		class: className,
		children
	}: {
		class?: string;
		children: Snippet;
	} = $props();
</script>

<CollapsibleContent
	animation="height"
	class={cn('overflow-hidden border-t border-border', className)}
>
	{@render children()}
</CollapsibleContent>
