<script lang="ts">
	import { Streamdown, type StreamdownProps } from 'svelte-streamdown';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import LegalMarkdownLink from './legal-markdown-link.svelte';
	import { LEGAL_LINK_PREFIXES } from './legal-markdown-link';
	import { localizedHref } from '$lib/utils/i18n';
	import {
		legalLiteralExtensions,
		resolveLegalLiteral,
		type LegalMarkdownContent
	} from '$lib/content/legal-template';

	interface LinkToken {
		href: string;
		title?: string | null;
	}

	interface LinkSnippetProps {
		children: Snippet;
		token: LinkToken;
		href?: string | null;
	}

	type ChildrenSnippetProps = Parameters<NonNullable<StreamdownProps['children']>>[0];

	let { content }: { content: LegalMarkdownContent } = $props();
</script>

{#snippet link({ children, token, href }: LinkSnippetProps)}
	<LegalMarkdownLink
		{children}
		{token}
		transformedHref={href ?? null}
		currentUrl={page.url}
		localize={localizedHref}
	/>
{/snippet}

{#snippet children({ token, children: fallbackChildren }: ChildrenSnippetProps)}
	{#if token.type === 'legalLiteral'}
		<span class="legal-literal" style="white-space: pre-wrap"
			>{resolveLegalLiteral(token, content.literals)}</span
		>
	{:else}
		{@render fallbackChildren()}
	{/if}
{/snippet}

<Streamdown
	content={content.markdown}
	{link}
	{children}
	extensions={legalLiteralExtensions}
	defaultOrigin={page.url.origin}
	allowedLinkPrefixes={LEGAL_LINK_PREFIXES}
	baseTheme="shadcn"
	static
/>
