<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let { class: className, ...restProps }: HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span
	aria-hidden="true"
	data-testid="support-unread-indicator"
	class={cn(
		'block size-2.5 shrink-0 rounded-full bg-destructive ring-2 ring-background',
		className
	)}
	{...restProps}
></span>
