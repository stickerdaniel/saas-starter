<script lang="ts">
	import { Avatar as AvatarPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		appearance = 'default',
		class: className,
		...restProps
	}: AvatarPrimitive.ImageProps & {
		/** `placeholder` greys out a stand-in image. */
		appearance?: 'default' | 'placeholder';
	} = $props();
</script>

<AvatarPrimitive.Image
	bind:ref
	data-slot="avatar-image"
	class={cn(
		'aspect-square size-full rounded-full object-cover group-data-[shape=square]/avatar:rounded-lg',
		appearance === 'placeholder' && 'grayscale',
		className
	)}
	{...restProps}
/>
