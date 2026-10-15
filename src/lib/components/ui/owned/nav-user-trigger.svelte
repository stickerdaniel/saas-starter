<script lang="ts">
	import { Button, type ButtonProps } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<Button
	bind:ref
	variant="ghost"
	justify="start"
	class={cn('h-12 w-full gap-2 px-2 data-[state=open]:bg-muted', className)}
	{...restProps}
/>
