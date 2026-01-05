<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Row } from 'better-svelte-email/components';
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

<Row data-slot="item-header" class={cn('w-full', className)} {...restProps}>
	{@render children?.()}
</Row>
