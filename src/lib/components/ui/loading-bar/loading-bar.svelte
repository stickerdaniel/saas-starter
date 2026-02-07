<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	type LoadingBarProps = WithoutChildrenOrChild<ProgressPrimitive.RootProps> & {
		start?: number;
		showBackground?: boolean;
	};

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		start = 0,
		showBackground = true,
		...restProps
	}: LoadingBarProps = $props();

	const safeMax = $derived(Math.max(max ?? 100, 1));
	const clampedStart = $derived(Math.min(Math.max(start, 0), safeMax));
	const clampedValue = $derived(Math.min(Math.max(value ?? 0, 0), safeMax));
	const startPercent = $derived((clampedStart / safeMax) * 100);
	const widthPercent = $derived((Math.max(clampedValue - clampedStart, 0) / safeMax) * 100);
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	class={cn(
		'relative h-2 w-full overflow-hidden rounded-full',
		showBackground && 'bg-primary/20',
		className
	)}
	{value}
	{max}
	{...restProps}
>
	<div
		data-slot="progress-indicator"
		class="absolute inset-y-0 bg-primary transition-[left,width]"
		style="left: {startPercent}%; width: {widthPercent}%;"
	></div>
</ProgressPrimitive.Root>
