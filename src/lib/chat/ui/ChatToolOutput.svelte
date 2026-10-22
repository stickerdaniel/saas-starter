<script lang="ts">
	import * as CodeBlock from '#lib/components/ui/code-block/index.js';
	import { useHighlightedCode } from '#lib/hooks/use-highlighted-code.svelte.ts';
	import type { ToolOutputCode } from './tool-part-adapter.js';

	/**
	 * Formatted tool output highlighted by Shiki, the content of ChatTool's code block.
	 * ChatTool loads it lazily and shows the same code unhighlighted until it does.
	 */
	let { code, language }: Pick<ToolOutputCode, 'code' | 'language'> = $props();

	// Plain text is not a highlighter language, so it renders as is.
	const lines = useHighlightedCode(
		() => code,
		() => language
	);
</script>

<CodeBlock.Content wrap class="max-h-64">
	{#each lines.current as line, index (index)}
		<CodeBlock.Line code={line} />
	{/each}
</CodeBlock.Content>
