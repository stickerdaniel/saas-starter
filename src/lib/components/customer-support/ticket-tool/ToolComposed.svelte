<script lang="ts">
	import type { ToolPart, TicketSubmitData } from './types.js';
	import { Tool, ToolHeader, ToolContent, ToolDetails } from './index.js';

	let {
		toolPart,
		threadId,
		defaultOpen = false,
		onticketsubmit,
		onticketcancel,
		class: className
	}: {
		toolPart: ToolPart;
		threadId?: string;
		defaultOpen?: boolean;
		onticketsubmit?: (data: TicketSubmitData) => void;
		onticketcancel?: () => void;
		class?: string;
	} = $props();
</script>

<Tool {toolPart} {threadId} {defaultOpen} {onticketsubmit} {onticketcancel} class={className}>
	{#snippet children(toolPart, threadId, onticketsubmit, onticketcancel)}
		<ToolHeader {toolPart} />
		<ToolContent>
			<ToolDetails {toolPart} {threadId} {onticketsubmit} {onticketcancel} />
		</ToolContent>
	{/snippet}
</Tool>
