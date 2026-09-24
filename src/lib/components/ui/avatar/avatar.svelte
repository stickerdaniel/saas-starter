<script lang="ts">
	import { Avatar as AvatarPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		loadingStatus = $bindable('loading'),
		size = 'default',
		shape = 'circle',
		outline = 'none',
		surface = 'default',
		motion = 'none',
		class: className,
		...restProps
	}: AvatarPrimitive.RootProps & {
		size?: 'default' | 'sm' | 'lg' | 'xl';
		/** Image and fallback follow a square root through the avatar group. */
		shape?: 'circle' | 'square';
		/** Separates stacked avatars with a ring in the surface color behind them. */
		outline?: 'none' | 'background' | 'secondary';
		surface?: 'default' | 'primary';
		/** `stack` joins the hover motion that layout.css defines for t-avatar. */
		motion?: 'none' | 'stack';
	} = $props();
</script>

<AvatarPrimitive.Root
	bind:ref
	bind:loadingStatus
	data-slot="avatar"
	data-size={size}
	data-shape={shape === 'square' ? 'square' : undefined}
	class={cn(
		'group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten',
		size === 'xl' && 'data-[size=xl]:size-12',
		shape === 'square' && 'rounded-lg after:rounded-lg',
		outline === 'background' && 'outline outline-4 outline-background',
		outline === 'secondary' && 'outline outline-4 outline-secondary',
		surface === 'primary' && 'bg-primary',
		motion === 'stack' && 't-avatar',
		className
	)}
	{...restProps}
/>
