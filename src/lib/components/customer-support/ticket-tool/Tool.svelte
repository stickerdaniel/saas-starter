<script lang="ts">
	import { cn } from '$lib/utils';
	import { Collapsible } from '$lib/components/ui/collapsible/index.js';
	import type { ToolPart, TicketSubmitData } from './types.js';
	import type { Snippet } from 'svelte';

	let {
		toolPart,
		threadId,
		defaultOpen = false,
		open = $bindable(defaultOpen),
		onticketsubmit,
		onticketcancel,
		class: className,
		children
	}: {
		toolPart: ToolPart;
		threadId?: string;
		defaultOpen?: boolean;
		open?: boolean;
		onticketsubmit?: (data: TicketSubmitData) => void;
		onticketcancel?: () => void;
		class?: string;
		children: Snippet<[ToolPart, string | undefined, typeof onticketsubmit, typeof onticketcancel]>;
	} = $props();
</script>

<Collapsible
	bind:open
	class={cn('mt-3 overflow-hidden rounded-xl border border-border', className)}
>
	{@render children(toolPart, threadId, onticketsubmit, onticketcancel)}
</Collapsible>
