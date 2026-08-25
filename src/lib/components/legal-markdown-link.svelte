<script lang="ts">
	import { useStreamdown } from 'svelte-streamdown';
	import type { Snippet } from 'svelte';
	import { resolveLegalMarkdownLink } from './legal-markdown-link';

	interface LinkToken {
		href: string;
		title?: string | null;
	}

	let {
		children,
		token,
		transformedHref,
		currentUrl,
		localize
	}: {
		children: Snippet;
		token: LinkToken;
		transformedHref: string | null;
		currentUrl: URL;
		localize: (path: string) => string;
	} = $props();

	const streamdown = useStreamdown();
	const resolved = $derived(
		resolveLegalMarkdownLink(token.href, transformedHref, currentUrl, localize)
	);
</script>

{#if resolved}
	<a
		data-streamdown-link
		class={streamdown.theme.link.base}
		title={token.title ?? undefined}
		{...resolved.external
			? { href: resolved.href, target: '_blank', rel: 'noopener noreferrer' }
			: { href: resolved.href }}
	>
		{@render children()}
	</a>
{:else}
	<span data-streamdown-link-blocked class={streamdown.theme.link.blocked}>
		{@render children()}
	</span>
{/if}
