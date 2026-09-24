<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';

	export const badgeVariants = tv({
		base: 'h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap transition-colors focus-visible:ring-3 [&>svg]:pointer-events-none',
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
				secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
				destructive:
					'bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20',
				outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
				ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
				link: 'text-primary underline-offset-4 hover:underline',
				// Subtle status tints keep the secondary badge's link hover.
				success: 'bg-success/10 text-success dark:bg-success/20 [a]:hover:bg-secondary/80',
				warning: 'bg-warning/10 text-warning dark:bg-warning/20 [a]:hover:bg-secondary/80',
				info: 'bg-info/10 text-info dark:bg-info/20 [a]:hover:bg-secondary/80',
				'primary-subtle': 'bg-primary/10 text-primary dark:bg-primary/20 [a]:hover:bg-secondary/80',
				// Status borders keep the outline badge's link hover.
				'bordered-success':
					'border-success bg-success/10 text-success [a]:hover:bg-muted [a]:hover:text-muted-foreground',
				'bordered-warning':
					'border-warning bg-warning/10 text-warning [a]:hover:bg-muted [a]:hover:text-muted-foreground',
				'bordered-destructive':
					'border-destructive bg-destructive/10 text-destructive [a]:hover:bg-muted [a]:hover:text-muted-foreground',
				// The compact Pro badge keeps the default badge's link hover.
				premium:
					'h-auto bg-premium/15 px-1.5 py-0.5 text-2xs leading-none text-premium-foreground [a]:hover:bg-primary/80'
			},
			size: {
				default: '',
				xs: 'px-1.5 py-0 text-2xs',
				chip: 'h-8 gap-1.5 pr-1 pl-2.5'
			},
			// A label attached to a sibling Button follows its press and disabled state.
			attachment: {
				none: '',
				'oauth-last-used':
					'transition-colors group-has-[[data-slot=button]:active:not([aria-haspopup])]:translate-y-px group-has-[[data-slot=button]:disabled]:badge-secondary-disabled'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
			attachment: 'none'
		}
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
	export type BadgeSize = VariantProps<typeof badgeVariants>['size'];
	export type BadgeAttachment = VariantProps<typeof badgeVariants>['attachment'];
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = 'default',
		size = 'default',
		attachment = 'none',
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
		size?: BadgeSize;
		attachment?: BadgeAttachment;
	} = $props();
</script>

<svelte:element
	this={href ? 'a' : 'span'}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant, size, attachment }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
