<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- The marketing header's logo link, pulled left so the mark aligns with the page edge. -->
<Button
	bind:ref
	variant="ghost"
	class={cn('-ml-3.5 flex items-center gap-2 px-3 font-semibold', className)}
	{...restProps}
/>
