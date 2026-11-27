<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const popoverContentVariants = tv({
		variants: {
			variant: {
				default: '',
				// Clipped text opened by a tap matches the Tooltip that hover and focus show.
				tooltip:
					'toggletip-bounds w-fit gap-0 bg-foreground px-3 py-1.5 text-xs text-background shadow-none ring-0'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type PopoverContentVariant = VariantProps<typeof popoverContentVariants>['variant'];
</script>

<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import PopoverPortal from './popover-portal.svelte';
	import { cn, type WithoutChildrenOrChild } from '#lib/utils.js';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		align = 'center',
		variant = 'default',
		portalProps,
		...restProps
	}: PopoverPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof PopoverPortal>>;
		variant?: PopoverContentVariant;
	} = $props();
</script>

<PopoverPortal {...portalProps}>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		data-variant={variant}
		{sideOffset}
		{align}
		class={cn(
			'z-50 flex w-72 origin-(--transform-origin) flex-col gap-4 rounded-md bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=inline-end]:slide-in-from-left-2 motion-safe:data-[side=inline-start]:slide-in-from-right-2 motion-safe:data-[side=left]:slide-in-from-right-2 motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 motion-safe:data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 motion-safe:data-closed:zoom-out-95',
			popoverContentVariants({ variant }),
			className
		)}
		{...restProps}
	/>
</PopoverPortal>
