<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
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
		content = ''
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
	} = $props();

	const { t } = getTranslate();
	const labelId = $props.id();

	const running = $derived(!hasContent || isStreaming);
	// Connecting (nothing back yet), Thinking (receiving), then done.
	const label = $derived(
		running
			? $t(hasContent ? 'chat.reasoning.thinking' : 'chat.reasoning.connecting')
			: $t('chat.reasoning.thought_for_few_seconds')
	);
</script>

{#snippet line()}
	<Trace.Line status={running ? 'running' : undefined}>
		<Trace.Icon>
			{#if running}
				<LoaderCircleIcon class="motion-safe:animate-spin" />
			{:else}
				<CircleCheckIcon />
			{/if}
		</Trace.Icon>
		<Trace.Title><span aria-hidden="true">{label}</span></Trace.Title>
	</Trace.Line>
{/snippet}

<!-- The painted label is hidden and this one live node carries it, outside the line so it
     survives the switch from plain line to trigger and announces Connecting, Thinking and
     the result alike. The trigger takes its name from it. No `role="status"`: a status
     node does not contribute its text to a name. -->
<span id={labelId} class="sr-only" aria-live="polite">{label}</span>

{#if hasContent}
	<Trace.Collapsible {open} {onOpenChange}>
		<Trace.CollapsibleTrigger aria-labelledby={labelId}>{@render line()}</Trace.CollapsibleTrigger>
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
