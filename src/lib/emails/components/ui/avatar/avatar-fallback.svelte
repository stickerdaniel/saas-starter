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
	data-slot="avatar-fallback"
	class={cn('flex size-full items-center justify-center rounded-full bg-muted', className)}
	{...restProps}
>
	{@render children?.()}
</div>
