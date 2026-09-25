<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- The 16px remove control nested inside a removable filter chip. -->
<Button
	bind:ref
	variant="ghost"
	size="icon-xs"
	shape="pill"
	class={cn('size-4 text-muted-foreground hover:bg-foreground/10 hover:text-foreground', className)}
	{...restProps}
/>
