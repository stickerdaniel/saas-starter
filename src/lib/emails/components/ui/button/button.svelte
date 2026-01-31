<script lang="ts" module>
	/* eslint-disable svelte/no-navigation-without-resolve -- Email component, not SvelteKit */
	import { type VariantProps, tv } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: 'block text-center shrink-0 overflow-hidden rounded-md text-sm font-medium whitespace-nowrap',
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground shadow-2xs',
				destructive: 'bg-destructive text-white shadow-2xs',
				outline: 'bg-background text-foreground border shadow-2xs',
				secondary: 'bg-secondary text-secondary-foreground shadow-2xs',
				ghost: 'text-foreground',
				link: 'text-primary underline underline-offset-4'
			},
			size: {
				default: 'h-9 px-4 py-2',
				sm: 'h-8 gap-1.5 rounded-md px-3',
				lg: 'h-10 rounded-md px-6',
				icon: 'size-9'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = {
		ref?: HTMLElement | null;
		variant?: ButtonVariant;
		size?: ButtonSize;
		href?: string;
		target?: string;
		class?: string;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		variant = 'default',
		size = 'default',
		href = '#',
		target = '_blank',
		class: className,
		children,
		...restProps
	}: ButtonProps & HTMLAnchorAttributes & { children?: Snippet } = $props();
</script>

<a
	bind:this={ref}
	data-slot="button"
	{href}
	{target}
	class={cn(buttonVariants({ variant, size }), className)}
	{...restProps}
>
	{@render children?.()}
</a>
