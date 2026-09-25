<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		sticky = false,
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableSectionElement>> & {
		/** Pins the header over a scrolling table body. */
		sticky?: boolean;
	} = $props();
</script>

<thead
	bind:this={ref}
	data-slot="table-header"
	class={cn(
		'[&_tr]:border-b',
		sticky && 'sticky top-0 z-10 bg-muted dark:bg-background',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</thead>
