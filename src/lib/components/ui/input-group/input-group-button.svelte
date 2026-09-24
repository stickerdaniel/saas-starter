<script lang="ts" module>
	export type InputGroupButtonSize = 'xs' | 'sm' | 'icon-xs' | 'icon-sm' | undefined;
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		type = 'button',
		variant = 'ghost',
		size = 'xs',
		...restProps
	}: Omit<ComponentProps<typeof Button>, 'href' | 'size'> & {
		size?: InputGroupButtonSize;
	} = $props();
</script>

<Button
	bind:ref
	{type}
	data-size={size}
	{variant}
	class={cn(
		'flex items-center gap-2 text-sm shadow-none',
		size === 'xs' &&
			"h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
		size === 'sm' && '',
		size === 'icon-xs' && 'size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0',
		size === 'icon-sm' && 'size-8 p-0 has-[>svg]:p-0',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</Button>
