<script lang="ts">
	import { Bot } from '@lucide/svelte';
	import { supportThreadContext } from './support-thread-context.svelte';
	import NavigationButton from './navigation-button.svelte';
	import AvatarHeading from './avatar-heading.svelte';

	let {
		subtitle = 'Our bot will reply instantly',
		onClose,
		showBackButton = true
	}: {
		subtitle?: string;
		onClose: () => void;
		showBackButton?: boolean;
	} = $props();

	const ctx = supportThreadContext.get();

	// Derive agent name from messages with fallback
	let agentName = $derived(ctx.currentAgentName || 'Kai');
</script>

<div class="flex shrink-0 items-center gap-2 border-b border-border/50 bg-secondary p-4">
	<!-- Back button -->
	{#if showBackButton}
		<NavigationButton type="back" onclick={() => ctx.goBack()} />
	{/if}

	<div class="flex-1">
		<AvatarHeading icon={Bot} title={agentName} {subtitle} />
	</div>

	<!-- Close button -->
	<NavigationButton type="close" onclick={onClose} />
</div>
