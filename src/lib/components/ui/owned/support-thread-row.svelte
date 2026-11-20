<script lang="ts">
	import { Button, type ButtonProps } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- A customer's conversation in the support widget. The list and the open conversation
     are separate views, so a row has no selected state, unlike the admin inbox rows. -->
<Button
	bind:ref
	variant="ghost-tint"
	class={cn(
		'flex h-auto w-full items-center justify-start gap-3 border-b border-border/30 p-4 px-5 text-left font-normal whitespace-normal shadow-none transition-colors duration-150 active:translate-y-0',
		className
	)}
	{...restProps}
/>
