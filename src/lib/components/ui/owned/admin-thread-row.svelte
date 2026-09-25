<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'> & {
		selected?: boolean;
	};

	let { selected = false, ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- A conversation in the admin support inbox, tinted separately in light and dark. -->
<Button
	bind:ref
	variant="ghost"
	class={cn(
		'h-auto w-full justify-start border-b p-4 text-left font-normal whitespace-normal shadow-none active:translate-y-0 dark:bg-muted/20',
		selected && 'bg-muted/70 dark:bg-muted/35',
		!selected && 'hover:bg-muted/30 dark:hover:bg-muted/50',
		className
	)}
	{...restProps}
/>
