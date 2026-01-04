<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLParagraphElement> & {
		ref?: HTMLElement | null;
		children?: Snippet;
	} = $props();
</script>

<p
	bind:this={ref}
	data-slot="item-description"
	class={cn(
		'text-sm leading-normal font-normal text-muted-foreground',
		'[&>a]:underline [&>a]:underline-offset-4',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</p>
