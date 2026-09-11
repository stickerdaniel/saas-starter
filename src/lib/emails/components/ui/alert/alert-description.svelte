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
	data-slot="alert-description"
	class={cn('text-sm text-muted-foreground dark:text-zinc-400', className)}
	{...restProps}
>
	{@render children?.()}
</div>
