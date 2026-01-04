<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		ref?: HTMLElement | null;
		children?: Snippet;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="item-title"
	class={cn('text-sm leading-snug font-medium pb-1', className)}
	{...restProps}
>
	{@render children?.()}
</div>
