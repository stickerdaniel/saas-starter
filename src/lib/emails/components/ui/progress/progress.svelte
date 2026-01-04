<script lang="ts">
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value = 0,
		...restProps
	}: {
		ref?: HTMLElement | null;
		class?: string;
		max?: number;
		value?: number;
	} = $props();

	const percentage = $derived(Math.min(100, Math.max(0, (value / max) * 100)));
</script>

<div
	bind:this={ref}
	data-slot="progress"
	role="progressbar"
	aria-valuenow={value}
	aria-valuemin={0}
	aria-valuemax={max}
	class={cn('h-2 w-full overflow-hidden rounded-full bg-neutral-300', className)}
	{...restProps}
>
	<div data-slot="progress-indicator" class="h-full bg-primary" style="width: {percentage}%"></div>
</div>
