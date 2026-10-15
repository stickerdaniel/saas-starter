<script lang="ts">
	import { ScrollArea as ScrollAreaPrimitive } from 'bits-ui';
	import { Scrollbar } from './index.js';
	import { cn, type WithoutChild } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		viewportRef = $bindable(null),
		class: className,
		orientation = 'vertical',
		scrollbarXClasses = '',
		scrollbarYClasses = '',
		children,
		...restProps
	}: WithoutChild<ScrollAreaPrimitive.RootProps> & {
		orientation?: 'vertical' | 'horizontal' | 'both' | undefined;
		scrollbarXClasses?: string | undefined;
		scrollbarYClasses?: string | undefined;
		viewportRef?: HTMLElement | null;
	} = $props();
</script>

<ScrollAreaPrimitive.Root
	bind:ref
	data-slot="scroll-area"
	class={cn('relative', className)}
	{...restProps}
>
	<!-- Bits UI sets an inline `overflow: hidden` until its scrollbar mounts on the
	     client, so the server HTML cannot scroll before hydration or without
	     JavaScript. The important overflow keyed on orientation outranks that
	     inline style; Bits hides the native scrollbar with a global rule. -->
	<ScrollAreaPrimitive.Viewport
		bind:ref={viewportRef}
		data-slot="scroll-area-viewport"
		data-orientation={orientation}
		class="size-full rounded-[inherit] outline-hidden transition-field-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-[orientation=both]:overflow-auto! data-horizontal:overflow-x-auto! data-vertical:overflow-y-auto!"
	>
		{@render children?.()}
	</ScrollAreaPrimitive.Viewport>
	{#if orientation === 'vertical' || orientation === 'both'}
		<!-- eslint-disable-next-line shadcn/require-static-classes -- forwards the caller's public scrollbarYClasses prop, kept for fork compatibility -->
		<Scrollbar orientation="vertical" class={scrollbarYClasses} />
	{/if}
	{#if orientation === 'horizontal' || orientation === 'both'}
		<!-- eslint-disable-next-line shadcn/require-static-classes -- forwards the caller's public scrollbarXClasses prop, kept for fork compatibility -->
		<Scrollbar orientation="horizontal" class={scrollbarXClasses} />
	{/if}
	<ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
