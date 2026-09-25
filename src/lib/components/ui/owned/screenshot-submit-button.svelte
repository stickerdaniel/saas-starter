<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- The text save action from sm up; below it an icon button takes its place. -->
<Button bind:ref class={cn('hidden px-4 sm:inline-flex', className)} {...restProps} />
