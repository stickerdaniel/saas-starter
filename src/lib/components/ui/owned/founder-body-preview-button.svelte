<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- A scrollable preview of the email body that reads as a text field and opens the
     editor when pressed. -->
<Button
	bind:ref
	variant="ghost"
	class={cn(
		'h-auto max-h-60 w-full cursor-text justify-start overflow-y-auto rounded-md border bg-muted/30 p-3 text-left text-sm font-normal whitespace-normal shadow-none active:translate-y-0',
		className
	)}
	{...restProps}
/>
