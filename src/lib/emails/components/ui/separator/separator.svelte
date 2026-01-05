<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	type Orientation = 'horizontal' | 'vertical';

	let {
		ref = $bindable(null),
		orientation = 'horizontal' as Orientation,
		class: className,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		ref?: HTMLElement | null;
		orientation?: Orientation;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="separator"
	data-orientation={orientation}
	role="separator"
	class={cn(
		'shrink-0 bg-border',
		orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
		className
	)}
	{...restProps}
></div>
