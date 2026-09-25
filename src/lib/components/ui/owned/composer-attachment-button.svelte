<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'> & {
		/** The compact composer drops the outline chrome but keeps its hover and open states. */
		compact?: boolean;
	};

	let { compact = false, ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<Button
	bind:ref
	variant="outline"
	size="icon"
	shape="pill"
	class={cn(compact && 'border-0 bg-transparent shadow-none', className)}
	{...restProps}
/>
