<script lang="ts">
	import { cn } from '$lib/utils';
	import { buttonVariants } from '$lib/components/ui/button';
	import type { ButtonVariant, ButtonSize } from '$lib/components/ui/button/index.js';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { WithChildren, WithoutChildren } from 'bits-ui';

	type PromptInputButtonAttrs = WithoutChildren<Omit<HTMLButtonAttributes, 'type'>>;

	type Props = WithChildren<PromptInputButtonAttrs> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		ref?: HTMLButtonElement | null;
	};

	let { variant = 'ghost', class: className, size, children, ...props }: Props = $props();
	let buttonProps = $derived(props as PromptInputButtonAttrs);

	let hasMultipleChildren = $derived.by(() => {
		// In Svelte, we can't easily count children like in React, so we'll default to checking if size is provided
		return size !== undefined;
	});

	let newSize = $derived.by((): 'default' | 'sm' | 'lg' | 'icon' => {
		return (size ?? hasMultipleChildren) ? 'default' : 'icon';
	});
</script>

<button
	class={cn(
		buttonVariants({ variant, size: newSize }),
		'shrink-0 gap-1.5 rounded-lg',
		variant === 'ghost' && 'text-muted-foreground',
		newSize === 'default' && 'px-3',
		className
	)}
	type="button"
	{...buttonProps}
>
	{#if children}
		{@render children()}
	{/if}
</button>
