<script lang="ts">
	import { useStreamdown } from 'svelte-streamdown';
	import type { Tokens } from 'marked';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import * as CodeBlock from '#lib/components/ui/code-block/index.js';
	import { codeColors } from '#lib/docs/code-colors.js';
	import { codeKey, fenceCode, type CodeToken, type PageCode } from '#lib/docs/code-lines.js';
	import { parseCodeMeta } from '#lib/docs/code-meta.js';

	let {
		token,
		id,
		highlights
	}: { token: Tokens.Code & { meta?: string }; id: string; highlights: PageCode } = $props();

	const streamdown = useStreamdown();
	const code = $derived(fenceCode(token.text));
	const lines = $derived<CodeToken[][]>(
		highlights[codeKey(token.lang, code)] ??
			code.split('\n').map((value) => (value ? [{ value }] : []))
	);
	const meta = $derived(parseCodeMeta(token.meta, lines.length));
	const theme = $derived(streamdown.theme.code);
</script>

{#snippet content()}
	<code
		>{#each lines as line, index (index)}<span
				class={[theme.line, meta.lineNumbers && theme.lineNumber]}
				>{#if line.length === 0}&#8203;{/if}{#each line as run, at (at)}<span
						class="token"
						style:--light={codeColors.light[run.className ?? 'token']}
						style:--dark={codeColors.dark[run.className ?? 'token']}>{run.value}</span
					>{/each}</span
			>{/each}</code
	>
{/snippet}

<CodeBlock.Root data-slot="docs-code" variant="docs" class="-mx-1 mt-6 w-auto">
	{#if meta.title}
		<div
			class="flex min-w-0 items-center gap-2 border-b border-border/30 px-4 py-2.5 pe-12 font-mono text-foreground"
		>
			<FileCodeIcon aria-hidden="true" class="size-4 shrink-0 opacity-70" />
			<span class="truncate">{meta.title}</span>
		</div>
	{/if}
	<div class={['absolute end-2 z-10', meta.title ? 'top-1.5' : 'top-3']}>
		<CodeBlock.CopyButton value={code} size="icon-sm" />
	</div>
	<div class="relative" data-streamdown-code={id}>
		{#each meta.highlighted as line (line)}
			<span aria-hidden="true" data-highlighted-line={line} class="highlight" style:--line={line}
			></span>
		{/each}
		<pre
			class={theme.pre}
			data-line-numbers={meta.lineNumbers || undefined}>{@render content()}</pre>
	</div>
</CodeBlock.Root>

<style>
	pre[data-line-numbers] {
		counter-reset: sd-line;
	}
	.token {
		color: var(--light);
	}
	:global(.dark) .token {
		color: var(--dark);
	}
	.highlight {
		position: absolute;
		inset-inline: 0;
		top: calc(0.875rem + (var(--line) - 1) * 1lh);
		height: 1lh;
		font-size: 0.875rem;
		line-height: 1.75;
		border-inline-start: 2px solid color-mix(in oklab, var(--muted-foreground) 50%, transparent);
		background: var(--muted);
		pointer-events: none;
	}
</style>
