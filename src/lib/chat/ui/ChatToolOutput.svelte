<script lang="ts">
	import * as CodeBlock from '#lib/components/ui/code-block/index.js';
	import { useHighlightedCode } from '#lib/hooks/use-highlighted-code.svelte.ts';

	/** A successful tool result as a height-capped code block, JSON highlighted by Shiki. */
	let { output }: { output: unknown } = $props();

	const isText = $derived(typeof output === 'string');
	const code = $derived(typeof output === 'string' ? output : JSON.stringify(output, null, 2));
	// Plain text is not a highlighter language, so it renders as is.
	const lines = useHighlightedCode(
		() => code,
		() => (isText ? 'text' : 'json')
	);
</script>

<CodeBlock.Root size="sm">
	<CodeBlock.Actions>
		<CodeBlock.CopyButton value={code} />
	</CodeBlock.Actions>
	<CodeBlock.Content wrap class="max-h-64">
		{#each lines.current as line, index (index)}
			<CodeBlock.Line code={line} />
		{/each}
	</CodeBlock.Content>
</CodeBlock.Root>
