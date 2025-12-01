<script lang="ts">
	import { cn } from '$lib/utils';
	import Check from '@lucide/svelte/icons/check';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Ticket from '@lucide/svelte/icons/ticket';
	import X from '@lucide/svelte/icons/x';
	import MailWarning from '@lucide/svelte/icons/mail-warning';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button/index.js';
	import { CollapsibleTrigger } from '$lib/components/ui/collapsible/index.js';
	import ToolBadge from './ToolBadge.svelte';
	import type { ToolPart } from './types.js';
	import type { Component } from 'svelte';

	let {
		toolPart,
		class: className
	}: {
		toolPart: ToolPart;
		class?: string;
	} = $props();

	function getStateIcon(): Component {
		switch (toolPart.state) {
			case 'input-streaming':
				return Loader2;
			case 'input-available':
				return Ticket;
			case 'output-processing':
				return Loader2;
			case 'output-available':
				return Check;
			case 'output-error':
				return toolPart.errorText ? MailWarning : X;
			default:
				return Ticket;
		}
	}

	function getStateIconClass(): string {
		switch (toolPart.state) {
			case 'input-streaming':
				return 'h-4 w-4 animate-spin text-blue-500';
			case 'input-available':
				return 'h-4 w-4 text-orange-500';
			case 'output-processing':
				return 'h-4 w-4 animate-spin text-blue-500';
			case 'output-available':
				return 'h-4 w-4 text-green-500';
			case 'output-error':
				return 'h-4 w-4 text-red-500';
			default:
				return 'text-muted-foreground h-4 w-4';
		}
	}

	function getHeaderText(): string {
		switch (toolPart.state) {
			case 'input-streaming':
				return 'Submit Support Ticket';
			case 'output-processing':
				return 'Submitting Ticket';
			case 'output-available':
				return 'Ticket Submitted';
			case 'output-error':
				return toolPart.errorText ? 'Ticket Failed' : 'Ticket Cancelled';
			default:
				return 'Support Ticket';
		}
	}

	const StateIcon = $derived(getStateIcon());
	const stateIconClass = $derived(getStateIconClass());
	const headerText = $derived(getHeaderText());
</script>

<CollapsibleTrigger>
	{#snippet child({ props })}
		<Button
			{...props}
			variant="ghost"
			class={cn(
				'h-auto w-full justify-between rounded-b-none bg-background px-3 py-2 font-normal',
				className
			)}
		>
			<div class="flex items-center gap-2">
				<StateIcon class={stateIconClass} />
				<span class="text-sm font-medium">
					{headerText}
				</span>
				<ToolBadge state={toolPart.state} errorText={toolPart.errorText} />
			</div>
			<ChevronDown class="h-4 w-4" />
		</Button>
	{/snippet}
</CollapsibleTrigger>
