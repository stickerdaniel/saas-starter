<script lang="ts">
	import { cn } from '$lib/utils.js';

	let { class: className, ...rest } = $props();
</script>

<img
	src="/autumn.webp"
	alt="Autumn"
	class={cn('flex-none leading-none', className)}
	loading="lazy"
	decoding="async"
	width="40"
	height="40"
	{...rest}
/>
