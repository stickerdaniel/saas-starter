<script lang="ts">
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import { getTranslate } from '@tolgee/svelte';
	import * as Trace from '#lib/components/ui/trace/index.js';
	import type { ToolPart, ToolPhase } from './tool-part-adapter.js';

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

			{#if toolPart.state === 'output-available' && toolPart.output !== undefined}
				<div>
					<div class="mb-1.5 text-xs font-medium">{$t('chat.tool.output')}</div>
					<!-- Loaded when a reader opens the output, so Shiki stays out of the chat route. -->
					{#await import('./ChatToolOutput.svelte') then { default: ChatToolOutput }}
						<ChatToolOutput output={toolPart.output} />
					{/await}
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
