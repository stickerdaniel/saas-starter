<script lang="ts">
	import type { HTMLImgAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: HTMLImgAttributes & {
		ref?: HTMLImageElement | null;
	} = $props();
</script>

<img
	bind:this={ref}
	data-slot="avatar-image"
	class={cn('aspect-square size-full object-cover', className)}
	{...restProps}
/>
