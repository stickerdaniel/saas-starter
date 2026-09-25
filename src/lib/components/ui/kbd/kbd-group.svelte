<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		reveal = 'none',
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		/** Hides the shortcut until the named group around it is hovered. */
		reveal?: 'none' | 'menu-hover' | 'button-hover';
	} = $props();
</script>

<kbd
	bind:this={ref}
	data-slot="kbd-group"
	class={cn(
		'inline-flex items-center gap-1',
		reveal === 'menu-hover' && 'opacity-0 group-hover/menu-button:opacity-100',
		reveal === 'button-hover' && 'opacity-0 group-hover/button:opacity-100',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</kbd>
