<script lang="ts" module>
	import { shadcnTheme, type Theme } from 'svelte-streamdown';

	const none = { base: '' };

	export const DOCS_THEME: Theme = {
		...shadcnTheme,
		link: {
			...shadcnTheme.link,
			base: 'font-medium underline decoration-current/30 hover:decoration-current focus-visible:rounded-[0.125em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
		},
		h1: none,
		h2: none,
		h3: none,
		h4: none,
		h5: none,
		h6: none,
		paragraph: none,
		ul: none,
		ol: none,
		li: { base: '', checkbox: '' },
		blockquote: none,
		hr: none,
		strong: { base: 'font-semibold' },
		sup: none,
		sub: none,
		descriptionList: none,
		descriptionTerm: none,
		descriptionDetail: none,
		codespan: {
			base: 'relative rounded-md bg-muted px-[0.3rem] py-[0.2rem] font-mono text-[0.8rem] break-words'
		},
		image: { base: '', image: '' },
		table: {
			...shadcnTheme.table,
			base: 'no-scrollbar overflow-x-auto overflow-y-hidden',
			table: ''
		},
		thead: none,
		tbody: none,
		tr: none,
		th: none,
		td: none,
		code: {
			...shadcnTheme.code,
			base: 'contents',
			container: '',
			header: 'hidden',
			pre: 'relative no-scrollbar overflow-x-auto overflow-y-hidden px-4 py-3.5 font-mono text-sm leading-[1.75] data-line-numbers:px-0',
			line: 'block',
			lineNumber:
				'before:inline-block before:w-16 before:pe-6 before:text-end before:text-muted-foreground before:select-none'
		}
	};
</script>

<script lang="ts">
	import { Streamdown } from 'svelte-streamdown';
	import type { Token, Tokens } from 'marked';
	import type { Snippet } from 'svelte';
	import { getTranslate } from '@tolgee/svelte';
	import type { PageCode } from '#lib/docs/code-lines.js';
	import { HeadingIds, accessibleName, holdsLinkOrImage } from '#lib/docs/headings.js';
	import DocsCallout, { CALLOUT_ICONS, type CalloutKind } from './docs-callout.svelte';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import DocsCode from './docs-code.svelte';

	let {
		content,
		title,
		inline = false,
		highlights = {}
	}: { content: string; title: string; inline?: boolean; highlights?: PageCode } = $props();

	const { t } = getTranslate();
	const ids = $derived(new HeadingIds(title));
	function isCalloutKind(variant: string): variant is CalloutKind {
		return Object.hasOwn(CALLOUT_ICONS, variant);
	}

	function imageTheme(src: string): string | undefined {
		if (src.endsWith('#gh-light-mode-only')) return 'inline dark:hidden';
		if (src.endsWith('#gh-dark-mode-only')) return 'hidden dark:inline';
		return undefined;
	}
</script>

{#snippet heading({ token, children }: { token: Tokens.Heading; children: Snippet })}
	{@const id = ids.of(token)}
	{#if holdsLinkOrImage(token.tokens)}
		<svelte:element this={`h${token.depth}`} {id} class="group/anchor">
			{@render children()}<a
				href="#{id}"
				aria-label={$t('docs.section_link', { heading: accessibleName(token.tokens) })}
				class="ms-2 text-muted-foreground no-underline opacity-0 group-hover/anchor:opacity-100 focus-visible:opacity-100"
				>#</a
			>
		</svelte:element>
	{:else}
		<svelte:element this={`h${token.depth}`} {id}>
			<a href="#{id}" class="group/anchor no-underline hover:underline"
				>{@render children()}<span
					aria-hidden="true"
					class="ms-2 text-muted-foreground opacity-0 group-hover/anchor:opacity-100">#</span
				></a
			>
		</svelte:element>
	{/if}
{/snippet}

{#snippet code({ token }: { token: Tokens.Code; children: Snippet })}
	<DocsCode {token} id="docs-code" {highlights} />
{/snippet}

{#snippet alert({ token, children }: { token: { variant: string }; children: Snippet })}
	{#if isCalloutKind(token.variant)}
		<DocsCallout kind={token.variant}>{@render children()}</DocsCallout>
	{:else}
		{@render children()}
	{/if}
{/snippet}

{#snippet li({
	token,
	children
}: {
	token: { task: boolean; checked: boolean; value: number | null; tokens: Token[] };
	children: Snippet;
})}
	<li
		value={!token.task && token.value ? token.value : undefined}
		class={token.task ? 'task-list-item' : undefined}
	>
		{#if token.task}
			<!-- The reference styles a native task checkbox (typeset.css:218-222); src/AGENTS.md asks for the shadcn Checkbox, so the typeset rule below targets it, and the text a reader sees in the item's first block names it, which Streamdown's own checkbox lacks. -->
			<Checkbox
				disabled
				checked={token.checked}
				aria-label={accessibleName(
					token.tokens.filter((block) => block.type !== 'space').slice(0, 1)
				)}
			/>
		{/if}
		{@render children()}
	</li>
{/snippet}

{#snippet image({ token, src }: { token: Tokens.Image; src?: string; children: Snippet })}
	<img {src} alt={token.text} class={imageTheme(token.href)} />
{/snippet}

<svelte:element this={inline ? 'span' : 'div'} class={inline ? undefined : 'typeset'}>
	<Streamdown
		{content}
		{inline}
		static
		theme={DOCS_THEME}
		mergeTheme={false}
		controls={{ code: false, table: false }}
		{heading}
		{code}
		{alert}
		{image}
		{li}
	/>
</svelte:element>

<style>
	.typeset {
		--flow: 1.25em;
		flex: 1;
		width: 100%;
		font-size: 1.125em;
		line-height: 1.75;
		overflow-wrap: break-word;
		color: var(--foreground);
	}
	@media (width >= 48rem), print {
		.typeset {
			font-size: 1em;
		}
	}
	.typeset :global(> div) {
		margin-trim: block-start;
	}
	.typeset :global(> div > *) {
		margin-top: var(--flow);
	}
	.typeset :global(p:not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
	}
	/* The reference keeps anchors below its header with scroll-padding-top on html; the docs header height lives on .docs-shell, so each heading carries it. */
	.typeset :global(:is(h1, h2, h3, h4, h5, h6)) {
		scroll-margin-top: calc(var(--docs-header-bottom) + var(--flow));
	}
	.typeset :global(:is(h1, h2, h3, h4, h5, h6):not(:where([data-slot], [data-slot] *))) {
		font-weight: 600;
	}
	.typeset :global(h1:not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
		font-size: 1.75em;
		line-height: 1.3;
	}
	.typeset :global(h2:not(:where([data-slot], [data-slot] *))) {
		margin-top: calc(var(--flow) * 1.4);
		font-size: 1.25em;
		line-height: 1.4;
	}
	.typeset :global(h3:not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
		font-size: 1.125em;
		line-height: 1.45;
	}
	.typeset :global(h4:not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
		font-size: 1em;
		line-height: 1.5;
	}
	.typeset :global(:is(h5, h6):not(:where([data-slot], [data-slot] *))) {
		line-height: 1.5;
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.typeset :global(h5:not(:where([data-slot], [data-slot] *))) {
		margin-top: calc(var(--flow) / 0.875);
		font-size: 0.875em;
	}
	.typeset :global(h6:not(:where([data-slot], [data-slot] *))) {
		margin-top: calc(var(--flow) / 0.8125);
		font-size: 0.8125em;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.typeset :global(:is(h1, h2, h3, h4, h5, h6) + *:not(:where([data-slot], [data-slot] *))) {
		margin-top: 1em;
	}
	.typeset :global(sup a:not(:where([data-slot], [data-slot] *))) {
		font-weight: 500;
		text-decoration-line: none;
	}
	.typeset :global(ul:not(:where([data-slot], [data-slot] *))) {
		list-style-type: disc;
	}
	.typeset :global(ol:not(:where([data-slot], [data-slot] *))) {
		list-style-type: decimal;
	}
	.typeset :global(ul ul:not(:where([data-slot], [data-slot] *))) {
		list-style-type: circle;
	}
	.typeset :global(ul ul ul:not(:where([data-slot], [data-slot] *))) {
		list-style-type: square;
	}
	.typeset :global(:is(ul, ol):not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
		padding-inline-start: 1.5em;
	}
	.typeset :global(li:not(:where([data-slot], [data-slot] *))) {
		margin-top: 0.5em;
		padding-inline-start: 0.4em;
	}
	.typeset :global(:is(ul, ol) > li:not(:where([data-slot], [data-slot] *))::marker) {
		color: var(--muted-foreground);
	}
	/* The reference drops the marker of every item in a list that holds a task (ul.contains-task-list); an ordinary item here keeps its marker, so only a task item drops it, and only a list of tasks alone narrows its start padding. */
	.typeset :global(li.task-list-item:not(:where([data-slot], [data-slot] *))) {
		list-style-type: none;
	}
	.typeset
		:global(
			ul:has(> li.task-list-item):not(:has(> li:not(.task-list-item))):not(
					:where([data-slot], [data-slot] *)
				)
		) {
		list-style-type: none;
		padding-inline-start: 0.25em;
	}
	.typeset :global(li > [data-slot='checkbox']) {
		display: inline-flex;
		margin-inline-end: 0.5em;
		vertical-align: -0.1em;
	}
	.typeset :global(dl:not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
	}
	.typeset :global(dt:not(:where([data-slot], [data-slot] *))) {
		margin-top: 1em;
		font-weight: 500;
	}
	.typeset :global(dd:not(:where([data-slot], [data-slot] *))) {
		margin-top: 0.25em;
		margin-inline-start: 0;
		padding-inline-start: 1em;
		color: var(--muted-foreground);
	}
	.typeset :global(blockquote:not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
		margin-inline: 0;
		border-inline-start: 2px solid var(--border);
		padding-inline-start: 1em;
	}
	.typeset :global(hr:not(:where([data-slot], [data-slot] *))) {
		margin-top: calc(var(--flow) * 2.4);
		border-top: 1px solid var(--border);
	}
	.typeset :global(hr + :is(h1, h2, h3, h4):not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
	}
	.typeset :global(img:not(:where([data-slot], [data-slot] *))) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius);
	}
	.typeset :global(p > img:not(.hidden, .dark\:hidden)) {
		display: inline;
	}
	.typeset :global(table:not(:where([data-slot], [data-slot] *))) {
		width: 100%;
		font-size: 1em;
		line-height: 1.5;
		font-variant-numeric: tabular-nums;
		border-collapse: separate;
		border-spacing: 0;
		border-bottom: 1px solid var(--border);
	}
	.typeset :global(div:where([data-streamdown-table]):not(:where([data-slot], [data-slot] *))) {
		margin-top: var(--flow);
	}
	.typeset :global(th:not(:where([data-slot], [data-slot] *))) {
		padding: 0.65em 1em;
		font-weight: 500;
		text-align: start;
		white-space: nowrap;
	}
	.typeset :global(td:not(:where([data-slot], [data-slot] *))) {
		padding: 0.75em 1em;
		text-align: start;
		vertical-align: top;
		border-top: 1px solid var(--border);
	}
	.typeset :global(:is(th, td):first-child:not(:where([data-slot], [data-slot] *))) {
		padding-inline-start: 0;
	}
	.typeset :global(:is(th, td)[align='center']:not(:where([data-slot], [data-slot] *))) {
		text-align: center;
	}
	.typeset :global(:is(th, td)[align='right']:not(:where([data-slot], [data-slot] *))) {
		text-align: end;
	}
	.typeset :global(li > :is(p, ul, ol, blockquote):not(:where([data-slot], [data-slot] *))) {
		margin-top: 0.5em;
	}
	@media print {
		.typeset :global(:is(table, blockquote):not(:where([data-slot], [data-slot] *))) {
			break-inside: avoid;
		}
		.typeset :global(:is(h1, h2, h3, h4):not(:where([data-slot], [data-slot] *))) {
			break-after: avoid;
		}
	}
	@media (forced-colors: active) {
		.typeset :global(:not(pre) > code:not(:where([data-slot], [data-slot] *))) {
			border: 1px solid;
		}
	}
	.typeset :global(> div > :first-child),
	.typeset :global(> div > :first-child > :first-child),
	.typeset
		:global(
			:is(li, blockquote, td, th, dd) > :first-child:not(:where([data-slot], [data-slot] *))
		) {
		margin-top: 0;
	}
</style>
