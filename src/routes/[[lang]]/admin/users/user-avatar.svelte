<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import TruncatedText from '$lib/components/truncated-text.svelte';

	let { name, image }: { name?: string; image?: string | null } = $props();

	const initials = $derived((name || 'U').slice(0, 2).toUpperCase());
</script>

<div class="flex min-w-0 items-center gap-2">
	<Avatar.Root>
		{#if image}
			<Avatar.Image src={image} alt={name || 'User'} referrerpolicy="no-referrer" />
		{/if}
		<Avatar.Fallback size="xs">{initials}</Avatar.Fallback>
	</Avatar.Root>
	<TruncatedText text={name || 'Unnamed'} class="flex-1 font-medium" />
</div>
