<script lang="ts">
	import {
		Reasoning,
		ReasoningTrigger,
		ReasoningContent
	} from '$lib/components/ai-elements/reasoning';

	let {
		open = false,
		onOpenChange,
		isStreaming = false,
		hasContent = false,
		content = ''
	}: {
		/** Whether the reasoning accordion is open */
		open?: boolean;
		/** Callback when open state changes */
		onOpenChange?: (open: boolean) => void;
		/** Whether reasoning is currently streaming */
		isStreaming?: boolean;
		/** Whether there is reasoning content */
		hasContent?: boolean;
		/** The reasoning content to display */
		content?: string;
	} = $props();
</script>

<Reasoning {open} {onOpenChange}>
	<ReasoningTrigger {isStreaming} {hasContent} />
	{#if content}
		<ReasoningContent class="opacity-50" {content} {isStreaming} />
	{/if}
</Reasoning>
