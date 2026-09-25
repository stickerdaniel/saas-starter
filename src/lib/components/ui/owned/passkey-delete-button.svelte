<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- Danger text on a ghost button; the destructive variant would fill it at rest. -->
<Button
	bind:ref
	variant="ghost"
	size="icon"
	class={cn('text-destructive hover:text-destructive', className)}
	{...restProps}
/>
