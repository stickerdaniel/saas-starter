<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		variant = 'default',
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableRowElement>> & {
		/**
		 * `header` fills the hovered header cells over a sticky header's surface, `inert`
		 * keeps an empty or error row from lighting up on hover.
		 */
		variant?: 'default' | 'header' | 'inert';
	} = $props();
</script>

<tr
	bind:this={ref}
	data-slot="table-row"
	class={cn(
		'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
		variant === 'header' && 'hover:[&>th]:bg-muted dark:hover:[&>th]:bg-background',
		variant === 'inert' && 'hover:!bg-transparent',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tr>
