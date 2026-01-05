<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const itemVariants = tv({
		base: 'rounded-md border border-transparent text-sm',
		variants: {
			variant: {
				default: 'bg-transparent',
				outline: 'border-border',
				muted: 'bg-muted/50'
			},
			size: {
				default: 'p-4',
				sm: 'px-4 py-3'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ItemSize = VariantProps<typeof itemVariants>['size'];
	export type ItemVariant = VariantProps<typeof itemVariants>['variant'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant,
		size,
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		ref?: HTMLElement | null;
		variant?: ItemVariant;
		size?: ItemSize;
		children?: Snippet;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="item"
	data-variant={variant}
	data-size={size}
	class={cn(itemVariants({ variant, size }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
