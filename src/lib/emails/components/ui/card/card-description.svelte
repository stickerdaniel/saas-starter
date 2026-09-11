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
	data-slot="card-description"
	class={cn('pb-1.5 text-sm text-muted-foreground dark:text-zinc-400', className)}
	{...restProps}
>
	{@render children?.()}
</p>
