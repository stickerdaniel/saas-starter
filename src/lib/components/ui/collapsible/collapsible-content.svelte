<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from 'bits-ui';

	import { cn } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		animation,
		...restProps
	}: CollapsiblePrimitive.ContentProps & { animation?: 'height' } = $props();
</script>

<CollapsiblePrimitive.Content
	bind:ref
	data-slot="collapsible-content"
	class={cn(
		animation === 'height' &&
			'motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down',
		className
	)}
	{...restProps}
/>
