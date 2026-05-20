<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		children: Snippet;
	} = $props();
</script>

<div class={cn('flex items-center gap-2', className)} {...restProps}>
	{@render children()}
</div>
