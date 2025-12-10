<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	const inputGroupButtonVariants = tv({
		base: 'flex items-center gap-2 text-sm shadow-none',
		variants: {
			size: {
				xs: "h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
				sm: 'h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5',
				'icon-xs': 'size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0',
				'icon-sm': 'size-8 p-0 has-[>svg]:p-0'
			}
		},
		defaultVariants: {
			size: 'xs'
		}
	});

	export type InputGroupButtonSize = VariantProps<typeof inputGroupButtonVariants>['size'];
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { ComponentProps, Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	type ButtonVariant = ComponentProps<typeof Button>['variant'];

	interface Props {
		ref?: HTMLButtonElement | null;
		class?: string;
		children?: Snippet;
		type?: 'button' | 'submit' | 'reset';
		variant?: ButtonVariant;
		size?: InputGroupButtonSize;
		disabled?: boolean;
		onclick?: (e: MouseEvent) => void;
		[key: string]: unknown;
	}

	let {
		ref = $bindable(null),
		class: className,
		children,
		type = 'button',
		variant = 'ghost',
		size = 'xs',
		...restProps
	}: Props = $props();
</script>

<Button
	bind:ref
	{type}
	data-size={size}
	{variant}
	class={cn(inputGroupButtonVariants({ size }), className)}
	{...restProps}
>
	{@render children?.()}
</Button>
