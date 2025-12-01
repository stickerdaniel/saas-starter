<script lang="ts">
	import { cn } from '$lib/utils';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import BotIcon from '@lucide/svelte/icons/bot';
	import ReasoningShimmerLoader from '$lib/components/prompt-kit/loader/reasoning-shimmer-loader.svelte';

	interface Props {
		class?: string;
		isStreaming?: boolean;
		hasContent?: boolean;
		duration?: number;
		children?: import('svelte').Snippet;
	}

	let {
		class: className = '',
		isStreaming = false,
		hasContent = false,
		duration = 0,
		children,
		...props
	}: Props = $props();

	// State 3: Finished - show duration
	let durationMessage = $derived.by(() => {
		if (duration && duration > 0) {
			return `Thought for ${duration} second${duration === 1 ? '' : 's'}`;
		}
		return 'Thought for a few seconds';
	});
</script>

<Accordion.Trigger
	disabled={!hasContent}
	class={cn(
		'flex items-start justify-start gap-2 py-0 text-sm text-muted-foreground hover:no-underline',
		className
	)}
	{...props}
>
	{#if children}
		{@render children()}
	{:else}
		<BotIcon class="size-4" />
		{#if !hasContent}
			<!-- State 1: Connecting - waiting for first reasoning content -->
			<ReasoningShimmerLoader text="Connecting..." />
		{:else if isStreaming}
			<!-- State 2: Thinking - receiving reasoning data -->
			<ReasoningShimmerLoader text="Thinking..." />
		{:else}
			<!-- State 3: Finished - show duration -->
			<p>{durationMessage}</p>
		{/if}
	{/if}
</Accordion.Trigger>
