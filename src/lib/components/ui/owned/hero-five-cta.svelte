<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	type Props = Omit<ButtonProps, 'variant' | 'size' | 'shape' | 'justify' | 'affordance'> & {
		/** `primary` is the sign-up call with a learn-more chevron, `demo` the ghost link beside it. */
		emphasis: 'primary' | 'demo';
	};

	let { emphasis, ref = $bindable(null), class: className, ...restProps }: Props = $props();
</script>

<Button
	bind:ref
	size="lg"
	shape="pill"
	variant={emphasis === 'demo' ? 'ghost' : 'default'}
	affordance={emphasis === 'primary' ? 'learn-more' : 'none'}
	class={cn(
		'pointer-events-auto h-12',
		emphasis === 'primary' && 'pr-3 pl-5 text-sm',
		emphasis === 'demo' && 'px-5 text-base hover:bg-foreground/5 dark:hover:bg-foreground/5',
		className
	)}
	{...restProps}
/>
