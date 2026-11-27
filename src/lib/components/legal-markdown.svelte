<script lang="ts">
	import { localizedHref } from '#lib/utils/i18n.js';
	import type { LegalDocument, LegalNode, LegalTableCell } from '#lib/content/legal-template.js';

	let { content }: { content: LegalDocument } = $props();

	const HEADING_CLASSES = {
		1: 'mt-6 mb-2 text-3xl font-semibold text-foreground',
		2: 'mt-6 mb-2 text-2xl font-semibold text-foreground',
		3: 'mt-6 mb-2 text-xl font-semibold text-foreground',
		4: 'mt-6 mb-2 text-lg font-semibold text-foreground',
		5: 'mt-6 mb-2 text-base font-semibold text-foreground',
		6: 'mt-6 mb-2 text-sm font-semibold text-foreground'
	} as const;
	const LINK_CLASS = 'text-primary wrap-anywhere font-medium underline hover:text-primary/80';
	const CELL_CLASS = 'px-4 py-3 text-sm text-foreground min-w-50 max-w-100 break-words';
	const ROW_CLASS = 'border-border not-last:border-b hover:bg-muted/50 transition-colors';

	function linkAttributes(node: Extract<LegalNode, { type: 'link' | 'localLink' }>) {
		if (node.type === 'localLink') return { href: localizedHref(node.path) };
		return node.external
			? { href: node.href, target: '_blank', rel: 'noopener noreferrer' }
			: { href: node.href };
	}
</script>

{#snippet cells(row: readonly LegalTableCell[], header: boolean)}
	<tr class={ROW_CLASS}>
		{#each row as cell (cell)}
			{#if header}
				<th class={CELL_CLASS} align={cell.align ?? 'left'}>{@render nodes(cell.children)}</th>
			{:else}
				<td class={CELL_CLASS} align={cell.align ?? 'left'}>{@render nodes(cell.children)}</td>
			{/if}
		{/each}
	</tr>
{/snippet}

{#snippet nodes(list: readonly LegalNode[])}
	{#each list as node (node)}
		{#if node.type === 'text'}
			{node.value}
		{:else if node.type === 'literal'}
			<span class="legal-literal whitespace-pre-wrap">{content.literals[node.name]}</span>
		{:else if node.type === 'heading'}
			<svelte:element this={`h${node.depth}`} class={HEADING_CLASSES[node.depth]}
				>{@render nodes(node.children)}</svelte:element
			>
		{:else if node.type === 'paragraph'}
			<p class="text-foreground">{@render nodes(node.children)}</p>
		{:else if node.type === 'strong'}
			<strong class="font-semibold text-foreground">{@render nodes(node.children)}</strong>
		{:else if node.type === 'em'}
			<em class="italic">{@render nodes(node.children)}</em>
		{:else if node.type === 'blocked'}
			<span class="text-muted-foreground">{@render nodes(node.children)}</span>
		{:else if node.type === 'link' || node.type === 'localLink'}
			<a class={LINK_CLASS} title={node.title} {...linkAttributes(node)}
				>{@render nodes(node.children)}</a
			>
		{:else if node.type === 'list'}
			{#if node.ordered}
				<ol class="ml-4 list-inside whitespace-normal text-foreground" start={node.start}>
					{#each node.items as item (item)}
						<li class="py-1">{@render nodes(item)}</li>
					{/each}
				</ol>
			{:else}
				<ul class="ml-4 list-inside list-disc whitespace-normal text-foreground">
					{#each node.items as item (item)}
						<li class="py-1">{@render nodes(item)}</li>
					{/each}
				</ul>
			{/if}
		{:else if node.type === 'hr'}
			<hr class="my-6 border-border" />
		{:else if node.type === 'codespan'}
			<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-code text-foreground"
				>{node.value}</code
			>
		{:else if node.type === 'code'}
			<div class="my-4 flex w-full flex-col overflow-hidden rounded-lg border border-border">
				<div
					class="flex items-center justify-between bg-muted/80 px-2 py-1 text-xs text-muted-foreground"
				>
					<span class="ml-1 font-mono lowercase">{node.lang}</span>
				</div>
				<div class="relative h-fit w-full overflow-visible bg-muted p-2 font-mono text-sm">
					<pre class="overflow-x-auto overflow-y-hidden bg-muted/40 p-0 font-mono"><code
							>{node.value}</code
						></pre>
				</div>
			</div>
		{:else if node.type === 'table'}
			<div
				class="group my-4 max-w-full overflow-x-auto overflow-y-hidden rounded-lg border border-border"
			>
				<table class="w-full min-w-full border-collapse">
					<thead class="bg-muted/80">{@render cells(node.head, true)}</thead>
					<tbody>
						{#each node.rows as row (row)}
							{@render cells(row, false)}
						{/each}
					</tbody>
				</table>
			</div>
		{:else if node.type === 'image'}
			<span class="group relative mx-auto my-4 block w-fit">
				<img class="max-w-full rounded-lg" src={node.src} alt={node.alt} />
			</span>
		{/if}
	{/each}
{/snippet}

<div>{@render nodes(content.nodes)}</div>
