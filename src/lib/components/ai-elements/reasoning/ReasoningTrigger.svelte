<script lang="ts">
	import { cn } from '$lib/utils';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import { getReasoningContext } from './reasoning-context.svelte.js';
	import BotIcon from '@lucide/svelte/icons/bot';
	import Loader from '$lib/components/prompt-kit/loader/loader.svelte';

	interface Props {
		class?: string;
		children?: import('svelte').Snippet;
	}

	let { class: className = '', children, ...props }: Props = $props();

	let reasoningContext = getReasoningContext();

	let getThinkingMessage = $derived.by(() => {
		let { isStreaming, duration } = reasoningContext;

		if (isStreaming) {
			return null; // Show loader instead
		}
		if (duration && duration > 0) {
			return `Thought for ${duration} second${duration === 1 ? '' : 's'}`;
		}
		return 'Thought for a few seconds';
	});
</script>

<Accordion.Trigger
	class={cn(
		'flex items-start justify-start gap-2  py-0 text-sm text-muted-foreground transition-colors hover:no-underline',
		className
	)}
	{...props}
>
	{#if children}
		{@render children()}
	{:else}
		<BotIcon class="size-4" />
		{#if reasoningContext.isStreaming}
			<Loader variant="text-shimmer" />
		{:else}
			<p>{getThinkingMessage}</p>
		{/if}
	{/if}
</Accordion.Trigger>
