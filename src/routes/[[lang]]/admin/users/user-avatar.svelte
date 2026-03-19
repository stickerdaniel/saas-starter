<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';

	let { name, image }: { name?: string; image?: string | null } = $props();

	const initials = $derived((name || 'U').slice(0, 2).toUpperCase());
</script>

<div class="flex items-center gap-2">
	<Avatar.Root class="size-8">
		{#if image}
			<Avatar.Image src={image} alt={name || 'User'} referrerpolicy="no-referrer" />
		{/if}
		<Avatar.Fallback class="text-xs">{initials}</Avatar.Fallback>
	</Avatar.Root>
	<span class="font-medium">{name || 'Unnamed'}</span>
</div>
