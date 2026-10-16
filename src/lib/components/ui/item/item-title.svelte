<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="item-title"
	class={cn(
		'flex w-fit max-w-full min-w-0 items-center gap-2 text-sm leading-snug font-medium underline-offset-4',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
