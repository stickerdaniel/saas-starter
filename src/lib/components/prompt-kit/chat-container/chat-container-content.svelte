<script lang="ts">
	import { cn } from '$lib/utils';

	import type { Snippet } from 'svelte';
	let {
		children,
		class: className,
		...restProps
	}: {
		children?: Snippet;
		class?: string;
		[key: string]: any;
	} = $props();
</script>

<div class={cn('flex w-full flex-col', className)} {...restProps}>
	{@render children?.()}
</div>
