<script lang="ts">
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';
	import type {
		ButtonPropsWithoutHTML,
		ButtonVariant,
		ButtonSize
	} from '$lib/components/ui/button/index.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { WithoutChildren } from 'bits-ui';

	type Props = ButtonPropsWithoutHTML &
		WithoutChildren<Omit<HTMLButtonAttributes, 'type'>> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};

	let { variant = 'ghost', class: className, size, children, ...props }: Props = $props();

	let hasMultipleChildren = $derived.by(() => {
		// In Svelte, we can't easily count children like in React, so we'll default to checking if size is provided
		return size !== undefined;
	});

	let newSize = $derived.by((): 'default' | 'sm' | 'lg' | 'icon' => {
		return (size ?? hasMultipleChildren) ? 'default' : 'icon';
	});
</script>

<Button
	class={cn(
		'shrink-0 gap-1.5 rounded-lg',
		variant === 'ghost' && 'text-muted-foreground',
		newSize === 'default' && 'px-3',
		className
	)}
	size={newSize}
	type="button"
	{variant}
	{...props}
>
	{#if children}
		{@render children()}
	{/if}
</Button>
