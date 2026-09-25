<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<Button
	bind:ref
	variant="secondary"
	size="sm"
	affordance="learn-more"
	class={cn('pr-2', className)}
	{...restProps}
/>
