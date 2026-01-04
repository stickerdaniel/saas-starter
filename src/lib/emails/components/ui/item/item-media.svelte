<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const itemMediaVariants = tv({
		base: '',
		variants: {
			variant: {
				default: 'bg-transparent',
				icon: 'bg-muted size-8 py-2 leading-4 text-center rounded-sm border',
				image: 'size-10 overflow-hidden rounded-sm'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type ItemMediaVariant = VariantProps<typeof itemMediaVariants>['variant'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Column } from 'better-svelte-email/components';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		ref?: HTMLElement | null;
		variant?: ItemMediaVariant;
		children?: Snippet;
	} = $props();
</script>

<Column class="w-10 pr-2 align-top">
	<div
		bind:this={ref}
		data-slot="item-media"
		data-variant={variant}
		class={cn(itemMediaVariants({ variant }), className)}
		{...restProps}
	>
		{@render children?.()}
	</div>
</Column>
