<script lang="ts">
	import { cn } from '$lib/utils';
	import type { ToolPart } from './types.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		toolPart,
		class: className,
		...restProps
	}: {
		toolPart: ToolPart;
		class?: string;
	} & HTMLAttributes<HTMLDivElement> = $props();

	function formatValue(value: unknown): string {
		if (value === null) return 'null';
		if (value === undefined) return 'undefined';
		if (typeof value === 'string') return value;
		if (typeof value === 'object') {
			return JSON.stringify(value, null, 2);
		}
		return String(value);
	}

	const { input, output, state, toolCallId, errorText } = $derived(toolPart);
</script>

<div class={cn('space-y-3 bg-background p-3', className)} {...restProps}>
	{#if input && Object.keys(input).length > 0}
		<div>
			<h4 class="mb-2 text-sm font-medium text-muted-foreground">Input</h4>
			<div class="rounded border bg-background p-2 font-mono text-sm">
				{#each Object.entries(input) as [key, value] (key)}
					<div class="mb-1">
						<span class="text-muted-foreground">{key}:</span>
						<span>{formatValue(value)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if output}
		<div>
			<h4 class="mb-2 text-sm font-medium text-muted-foreground">Output</h4>
			<div class="max-h-60 overflow-auto rounded border bg-background p-2 font-mono text-sm">
				<pre class="whitespace-pre-wrap">{formatValue(output)}</pre>
			</div>
		</div>
	{/if}

	{#if state === 'output-error' && errorText}
		<div>
			<h4 class="mb-2 text-sm font-medium text-red-500">Error</h4>
			<div
				class="rounded border border-red-200 bg-background p-2 text-sm dark:border-red-950 dark:bg-red-900/20"
			>
				{errorText}
			</div>
		</div>
	{/if}

	{#if state === 'input-streaming'}
		<div class="text-sm text-muted-foreground">Processing tool call...</div>
	{/if}

	{#if toolCallId}
		<div class="border-t border-blue-200 pt-2 text-xs text-muted-foreground">
			<span class="font-mono">Call ID: {toolCallId}</span>
		</div>
	{/if}
</div>
