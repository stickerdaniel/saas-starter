<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import { getTranslate } from '@tolgee/svelte';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import BotIcon from '@lucide/svelte/icons/bot';
	import ReasoningStatus from '$lib/components/prompt-kit/loader/reasoning-status.svelte';

	const { t } = getTranslate();

	interface Props {
		class?: string;
		isStreaming?: boolean;
		hasContent?: boolean;
		duration?: number;
		children?: Snippet;
	}

	let {
		class: className = '',
		isStreaming = false,
		hasContent = false,
		duration = 0,
		children,
		...props
	}: Props = $props();

	const isPending = $derived(!hasContent || isStreaming);

	let durationMessage = $derived.by(() => {
		if (duration && duration > 0) {
			return duration === 1
				? $t('chat.reasoning.thought_for_seconds', { duration })
				: $t('chat.reasoning.thought_for_seconds_plural', { duration });
		}
		return $t('chat.reasoning.thought_for_few_seconds');
	});
</script>

<Accordion.Trigger
	disabled={!hasContent}
	class={cn(
		'flex items-start justify-start gap-2 py-0 text-sm text-muted-foreground transition-colors hover:no-underline active:translate-y-px',
		className
	)}
	{...props}
>
	{#if children}
		{@render children()}
	{:else}
		<BotIcon class="size-4" />
		<!-- Connecting (nothing back yet), Thinking (receiving), then the duration.
		     One instance across all three: it is what carries a state change as a
		     swap, and it also stops the shimmer restarting on every transition. -->
		<ReasoningStatus
			text={isPending
				? hasContent
					? $t('chat.reasoning.thinking')
					: $t('chat.reasoning.connecting')
				: durationMessage}
			shimmer={isPending}
		/>
	{/if}
</Accordion.Trigger>
