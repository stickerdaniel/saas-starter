<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<Button
	bind:ref
	variant="secondary"
	size="icon-sm"
	shape="pill"
	class={cn('text-muted-foreground', className)}
	{...restProps}
/>
