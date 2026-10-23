<script lang="ts">
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import { getTranslate } from '@tolgee/svelte';
	import * as CodeBlock from '#lib/components/ui/code-block/index.js';
	import * as Trace from '#lib/components/ui/trace/index.js';
	import type { ToolPart, ToolPhase } from './tool-part-adapter.js';

	/**
	 * One tool call as a Trace line, after the AI Elements Tool pattern: a plain line while
	 * it runs, a collapsible once its output arrives. Unlike upstream, a failed call stays a
	 * plain line, because provider errors are diagnostic data, never product copy.
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
	// Text output shows as is, any other value as indented JSON.
	const output = $derived(
		phase !== 'ran' || toolPart.output === undefined
			? undefined
			: typeof toolPart.output === 'string'
				? toolPart.output
				: JSON.stringify(toolPart.output, null, 2)
	);
</script>

{#snippet line()}
	<Trace.Line status={lineStatus}>
		<Trace.Icon>
			<WrenchIcon />
		</Trace.Icon>
		<Trace.Title>{$t(titleKeys[phase], { tool: toolPart.name })}</Trace.Title>
	</Trace.Line>
{/snippet}

{#if output !== undefined}
	<Trace.Collapsible>
		<Trace.CollapsibleTrigger>{@render line()}</Trace.CollapsibleTrigger>
		<Trace.CollapsibleContent>
			<CodeBlock.Root size="sm">
				<CodeBlock.Content wrap class="max-h-64" code={output} />
			</CodeBlock.Root>
		</Trace.CollapsibleContent>
	</Trace.Collapsible>
{:else}
	{@render line()}
{/if}
