<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import { getTranslate } from '@tolgee/svelte';
	import * as Trace from '#lib/components/ui/trace/index.js';
	import { Response, streamingTextAnimation } from '#lib/components/ai-elements/response/index.js';

	/**
	 * One reasoning block as a Trace line, after the AI Elements Reasoning pattern: a plain
	 * line until text arrives, then a collapsible whose open state the caller owns.
	 */
	let {
		open = false,
		onOpenChange,
		isStreaming = false,
		hasContent = false,
		content = '',
		duration
	}: {
		/** Whether the reasoning is expanded */
		open?: boolean;
		/** Called when the reader expands or collapses it */
		onOpenChange?: (open: boolean) => void;
		/** Whether reasoning is currently streaming */
		isStreaming?: boolean;
		/** Whether there is reasoning content */
		hasContent?: boolean;
		/** The reasoning content to display */
		content?: string;
		/** Whole seconds the model spent thinking, when the server measured it */
		duration?: number;
	} = $props();

	const { t } = getTranslate();

	const running = $derived(!hasContent || isStreaming);
	// Connecting (nothing back yet), Thinking (receiving), then how long it took.
	const label = $derived.by(() => {
		if (running)
			return hasContent ? $t('chat.reasoning.thinking') : $t('chat.reasoning.connecting');
		if (duration && duration > 0) {
			return duration === 1
				? $t('chat.reasoning.thought_for_seconds', { duration })
				: $t('chat.reasoning.thought_for_seconds_plural', { duration });
		}
		return $t('chat.reasoning.thought_for_few_seconds');
	});
</script>

{#snippet line()}
	<Trace.Line status={running ? 'running' : undefined}>
		<Trace.Icon>
			{#if running}
				<CircleDashedIcon />
			{:else}
				<CircleCheckIcon />
			{/if}
		</Trace.Icon>
		<Trace.Title>{label}</Trace.Title>
	</Trace.Line>
{/snippet}

{#if hasContent}
	<Trace.Collapsible {open} {onOpenChange}>
		<Trace.CollapsibleTrigger>{@render line()}</Trace.CollapsibleTrigger>
		<Trace.CollapsibleContent>
			<!-- The markdown theme colours every block as foreground, so the muted Trace colour
			     cannot reach it; dimming the block keeps the reasoning quieter than the answer. -->
			<div class="opacity-50">
				<Response {content} animation={streamingTextAnimation(isStreaming)} class="grid gap-2" />
			</div>
		</Trace.CollapsibleContent>
	</Trace.Collapsible>
{:else}
	{@render line()}
{/if}
