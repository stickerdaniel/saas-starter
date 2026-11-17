<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<!-- Local change: motion-safe gates the shimmer. The stylesheet's reduced-motion
     rule only matches a bare `.shimmer` class, never these variant classes. -->
<span
	bind:this={ref}
	data-slot="attachment-title"
	class={cn(
		'block max-w-full min-w-0 truncate font-medium motion-safe:group-data-[state=processing]/attachment:shimmer motion-safe:group-data-[state=uploading]/attachment:shimmer',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</span>
