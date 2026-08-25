<script lang="ts">
	import { Streamdown } from 'svelte-streamdown';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import LegalMarkdownLink from './legal-markdown-link.svelte';
	import { localizedHref } from '$lib/utils/i18n';

	interface LinkToken {
		href: string;
		title?: string | null;
	}

	let { content }: { content: string } = $props();
</script>

{#snippet link({ children, token }: { children: Snippet; token: LinkToken })}
	<LegalMarkdownLink {children} {token} localize={localizedHref} />
{/snippet}

<Streamdown {content} {link} defaultOrigin={page.url.origin} baseTheme="shadcn" static />
