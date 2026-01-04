<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Column } from 'better-svelte-email/components';
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

<Column class="align-top">
	<div bind:this={ref} data-slot="item-content" class={cn(className)} {...restProps}>
		{@render children?.()}
	</div>
</Column>
