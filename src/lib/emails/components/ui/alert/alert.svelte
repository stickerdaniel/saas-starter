<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';

	export const alertVariants = tv({
		base: 'relative w-full rounded-lg border px-4 py-3 text-sm',
		variants: {
			variant: {
				default:
					'bg-card text-card-foreground dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50',
				destructive: 'text-destructive bg-card border-destructive dark:bg-zinc-900'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type AlertVariant = VariantProps<typeof alertVariants>['variant'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		ref?: HTMLElement | null;
		variant?: AlertVariant;
		children?: Snippet;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="alert"
	class={cn(alertVariants({ variant }), className)}
	{...restProps}
	role="alert"
>
	{@render children?.()}
</div>
