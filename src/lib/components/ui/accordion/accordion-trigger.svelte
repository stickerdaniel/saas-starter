<script lang="ts">
	import { Accordion as AccordionPrimitive } from 'bits-ui';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		level = 3,
		children,
		...restProps
	}: WithoutChild<AccordionPrimitive.TriggerProps> & {
		level?: AccordionPrimitive.HeaderProps['level'];
	} = $props();
</script>

<AccordionPrimitive.Header {level} class="flex">
	<AccordionPrimitive.Trigger
		data-slot="accordion-trigger"
		bind:ref
		class={cn(
			'group flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg[data-accordion-chevron]]:rotate-180',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		<ChevronDownIcon
			data-accordion-chevron
			class="pointer-events-none size-4 shrink-0 translate-y-0.5 text-muted-foreground transition-all duration-200 group-hover:text-foreground"
		/>
	</AccordionPrimitive.Trigger>
</AccordionPrimitive.Header>
