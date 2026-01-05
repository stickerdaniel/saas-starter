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

<div bind:this={ref} data-slot="card-content" class={cn('px-6 pt-6', className)} {...restProps}>
	{@render children?.()}
</div>
