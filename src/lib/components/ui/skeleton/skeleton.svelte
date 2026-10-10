<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> = $props();
</script>

<!-- Static on purpose: a pulse makes the browser draw a new frame at the display's
     refresh rate for as long as the page waits. -->
<div
	bind:this={ref}
	data-slot="skeleton"
	class={cn('rounded-md bg-muted', className)}
	{...restProps}
></div>
