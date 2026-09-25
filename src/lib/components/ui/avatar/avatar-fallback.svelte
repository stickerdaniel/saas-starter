<script lang="ts">
	import { Avatar as AvatarPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		variant = 'default',
		size = 'default',
		class: className,
		...restProps
	}: AvatarPrimitive.FallbackProps & {
		variant?: 'default' | 'primary';
		/** `xs` shrinks the initials inside a default-size avatar. */
		size?: 'default' | 'xs';
	} = $props();
</script>

<AvatarPrimitive.Fallback
	bind:ref
	data-slot="avatar-fallback"
	class={cn(
		'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs group-data-[shape=square]/avatar:rounded-lg',
		variant === 'primary' && 'bg-primary text-primary-foreground',
		size === 'xs' && 'text-xs',
		className
	)}
	{...restProps}
/>
