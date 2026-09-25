<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'> & {
		selected?: boolean;
	};

	let { selected = false, ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- A customer's conversation in the support widget. Its faint tints differ from the
     admin inbox rows on purpose. -->
<Button
	bind:ref
	variant="ghost"
	affordance="learn-more"
	class={cn(
		'flex h-auto w-full items-center justify-start gap-3 border-b border-border/30 p-4 px-5 text-left font-normal whitespace-normal shadow-none transition-colors duration-150 active:translate-y-0',
		selected && 'bg-muted-foreground/[0.04]',
		!selected && 'hover:bg-muted-foreground/[0.06]',
		className
	)}
	{...restProps}
/>
