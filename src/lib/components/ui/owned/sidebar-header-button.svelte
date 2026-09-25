<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'>;

	let { ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<!-- The app sidebar header: brand icon and title, filled while its menu is open. -->
<Button
	bind:ref
	variant="ghost"
	justify="start"
	class={cn('w-full gap-2 px-1.5 data-[state=open]:bg-muted', className)}
	{...restProps}
/>
