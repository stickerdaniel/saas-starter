<script lang="ts">
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import { getTranslate } from '@tolgee/svelte';
	import * as CodeBlock from '#lib/components/ui/code-block/index.js';
	import * as Trace from '#lib/components/ui/trace/index.js';
	import { formatToolOutput, type ToolPart, type ToolPhase } from './tool-part-adapter.js';

	/**
	 * One tool call as a Trace line, after the AI Elements Tool pattern. Unlike upstream,
	 * a running call already opens, so its input and call ID are readable while it runs.
	 */
	let { toolPart, phase }: { toolPart: ToolPart; phase: ToolPhase } = $props();

	const { t } = getTranslate();

	const titleKeys = {
		running: 'chat.tool.running',
		ran: 'chat.tool.ran',
		failed: 'chat.tool.failed'
	} as const satisfies Record<ToolPhase, string>;
	const lineStatus = $derived(
		phase === 'running' ? 'running' : phase === 'failed' ? 'error' : undefined
	);
	const inputEntries = $derived(Object.entries(toolPart.input ?? {}));
	// Read only inside the collapsible content, so a closed line never formats its output.
	const output = $derived(
		toolPart.state === 'output-available' && toolPart.output !== undefined
			? formatToolOutput(toolPart.output)
			: undefined
	);

	function formatValue(value: unknown): string {
		if (value === null) return 'null';
		if (value === undefined) return 'undefined';
		if (typeof value === 'string') return value;
		if (typeof value === 'object') return JSON.stringify(value, null, 2);
		return String(value);
	}
</script>

<Trace.Collapsible>
	<Trace.CollapsibleTrigger>
		<Trace.Line status={lineStatus}>
			<Trace.Icon>
				<WrenchIcon />
			</Trace.Icon>
			<Trace.Title>{$t(titleKeys[phase], { tool: toolPart.name })}</Trace.Title>
		</Trace.Line>
	</Trace.CollapsibleTrigger>
	<Trace.CollapsibleContent>
		<div class="space-y-3">
			{#if inputEntries.length > 0}
				<div>
					<div class="mb-1.5 text-xs font-medium">{$t('chat.tool.input')}</div>
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
						{#each inputEntries as [key, value] (key)}
							<dt>{key}:</dt>
							<dd class="min-w-0 wrap-break-word text-foreground">{formatValue(value)}</dd>
						{/each}
					</dl>
				</div>
			{/if}

			{#if output}
				<div>
					<div class="mb-1.5 text-xs font-medium">{$t('chat.tool.output')}</div>
					<CodeBlock.Root size="sm">
						<CodeBlock.Actions>
							<CodeBlock.CopyButton value={output.code} />
						</CodeBlock.Actions>
						<!-- Shiki loads when a reader opens the output, so it stays out of the chat route.
						     Until it does, or if its chunk fails to load, the same code shows plain. -->
						{#await import('./ChatToolOutput.svelte')}
							<CodeBlock.Content code={output.code} wrap class="max-h-64" />
						{:then { default: ChatToolOutput }}
							<ChatToolOutput code={output.code} language={output.language} />
						{:catch}
							<CodeBlock.Content code={output.code} wrap class="max-h-64" />
						{/await}
					</CodeBlock.Root>
					{#if output.truncated}
						<p class="mt-1.5 text-xs">{$t('chat.tool.output_truncated')}</p>
					{/if}
				</div>
			{/if}

			<!-- Provider errors are diagnostic data, never product copy: a failure shows only
			     fixed localized text, with nothing to copy. -->
			{#if phase === 'failed'}
				<div>
					<div class="mb-1.5 text-xs font-medium text-destructive">{$t('chat.tool.error')}</div>
					<p class="text-destructive">{$t('common.error')}</p>
				</div>
			{/if}

			{#if phase === 'running'}
				<div>{$t('chat.tool.processing')}</div>
			{/if}

			{#if toolPart.toolCallId}
				<div class="font-mono text-xs text-muted-foreground/70">
					{$t('chat.tool.call_id', { toolCallId: toolPart.toolCallId })}
				</div>
			{/if}
		</div>
	</Trace.CollapsibleContent>
</Trace.Collapsible>
