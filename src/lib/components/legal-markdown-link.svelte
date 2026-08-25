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
		localize
	}: {
		children: Snippet;
		token: LinkToken;
		localize: (path: string) => string;
	} = $props();

	const streamdown = useStreamdown();
	const resolved = $derived(
		resolveLegalMarkdownLink(
			token.href,
			localize,
			streamdown.allowedLinkPrefixes ?? [],
			streamdown.defaultOrigin
		)
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
	<span
		data-streamdown-link-blocked
		class={streamdown.theme.link.blocked}
		title={token.title ? `Blocked URL: ${token.href}` : undefined}
	>
		{@render children()} [blocked]
	</span>
{/if}
