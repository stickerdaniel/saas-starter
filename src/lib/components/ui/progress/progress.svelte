<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		...restProps
	}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();

	const safeMax = $derived(Math.max(max ?? 100, 1));
	const clampedValue = $derived(Math.min(Math.max(value ?? 0, 0), safeMax));
	const progressPercent = $derived((clampedValue / safeMax) * 100);
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	class={cn(
		'relative flex h-1.5 w-full items-center overflow-x-hidden rounded-full bg-muted',
		className
	)}
	{value}
	{max}
	{...restProps}
>
	<div
		data-slot="progress-indicator"
		class="size-full flex-1 bg-primary transition-all"
		style="transform: translateX(-{100 - progressPercent}%)"
	></div>
</ProgressPrimitive.Root>
