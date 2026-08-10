<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { quintOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { scale } from 'svelte/transition';
	import { cn } from '$lib/utils.js';

	let { class: className, ...restProps }: HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span
	aria-hidden="true"
	data-testid="support-unread-indicator"
	in:scale={{
		duration: prefersReducedMotion.current ? 100 : 160,
		start: prefersReducedMotion.current ? 1 : 0.8,
		easing: quintOut
	}}
	out:scale={{
		duration: prefersReducedMotion.current ? 100 : 120,
		start: prefersReducedMotion.current ? 1 : 0.8,
		easing: quintOut
	}}
	class={cn(
		'block size-2.5 shrink-0 rounded-full bg-destructive ring-2 ring-background',
		className
	)}
	{...restProps}
></span>
