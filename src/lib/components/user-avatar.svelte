<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import { userInitials } from '#lib/utils/user-initials.js';

	type RootProps = ComponentProps<typeof Avatar.Root>;
	type FallbackProps = ComponentProps<typeof Avatar.Fallback>;

	interface Props {
		name?: string | null;
		email?: string | null;
		image?: string | null;
		/** Empty marks the image decorative, for callers that show the name beside it. */
		alt?: string;
		max?: 1 | 2;
		size?: RootProps['size'];
		shape?: RootProps['shape'];
		surface?: RootProps['surface'];
		fallbackSize?: FallbackProps['size'];
		fallbackVariant?: FallbackProps['variant'];
	}

	let {
		name,
		email,
		image,
		alt = '',
		max = 2,
		size,
		shape,
		surface,
		fallbackSize,
		fallbackVariant
	}: Props = $props();

	const initials = $derived(userInitials(name, email, max));
</script>

<Avatar.Root {size} {shape} {surface}>
	<!-- Provider avatars (Google, GitHub) may refuse requests that carry a referrer.
	     The image stays mounted without a source, so removing a loaded photo
	     returns the avatar to its initials instead of leaving it blank. -->
	<Avatar.Image src={image || undefined} {alt} referrerpolicy="no-referrer" />
	<Avatar.Fallback size={fallbackSize} variant={fallbackVariant}>{initials}</Avatar.Fallback>
</Avatar.Root>
