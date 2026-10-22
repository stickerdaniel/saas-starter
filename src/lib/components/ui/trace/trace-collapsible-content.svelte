<script lang="ts">
	import * as Collapsible from '#lib/components/ui/collapsible/index.js';
	import { cn, type WithoutChild } from '#lib/utils.js';
	import type { Collapsible as CollapsiblePrimitive } from 'bits-ui';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<CollapsiblePrimitive.ContentProps> = $props();
</script>

<Collapsible.Content
	bind:ref
	data-slot="trace-collapsible-content"
	class="min-w-0 overflow-hidden duration-200 [--bits-accordion-content-height:var(--bits-collapsible-content-height)] motion-safe:data-open:animate-accordion-down motion-safe:data-closed:animate-accordion-up"
	{...restProps}
>
	<div
		data-slot="trace-collapsible-content-inner"
		class={cn(
			'mt-2 mb-1 ml-[calc(--spacing(2)_-_1px)] min-w-0 border-l pr-1 pl-4 leading-relaxed wrap-break-word text-muted-foreground',
			className
		)}
	>
		{@render children?.()}
	</div>
</Collapsible.Content>
