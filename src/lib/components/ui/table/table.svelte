<script lang="ts">
	import type { HTMLAttributes, HTMLTableAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		container,
		...restProps
	}: WithElementRef<HTMLTableAttributes> & {
		/** Opt into bounded scrolling without changing the table's own attributes. */
		container?: Pick<HTMLAttributes<HTMLDivElement>, 'class'> & { scrollPaddingTop?: string };
	} = $props();
</script>

<div
	data-slot="table-container"
	class={cn(
		'relative w-full overflow-x-auto',
		container?.class,
		container?.scrollPaddingTop && 'scroll-pt-(--table-scroll-padding-top)'
	)}
	style:--table-scroll-padding-top={container?.scrollPaddingTop}
>
	<table
		bind:this={ref}
		data-slot="table"
		class={cn('w-full caption-bottom text-sm', className)}
		{...restProps}
	>
		{@render children?.()}
	</table>
</div>
