<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: 'default' | 'sm' } = $props();
</script>

<!-- Deviation from upstream: the base classes live in layout.css as card-base. -->
<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	class={cn('group/card card-base', className)}
	{...restProps}
>
	{@render children?.()}
</div>
