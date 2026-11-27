<script lang="ts">
	import { Streamdown } from 'svelte-streamdown';
	import { getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Tokens } from 'marked';
	import type { Snippet } from 'svelte';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import { resolveSiteOrigin } from '#lib/config/site-origin.js';
	import { HeadingIds, headingSlug } from '#lib/docs/headings.js';
	import { docsPath } from '#lib/docs/urls.js';
	import { DEFAULT_LANGUAGE } from '#lib/i18n/languages.js';
	import { localizedHref } from '#lib/utils/i18n.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { t } = getTranslate();

	const ids = $derived(new HeadingIds(data.page.title));
	const canonicalUrl = $derived(
		`${resolveSiteOrigin(page.url.origin)}${docsPath(DEFAULT_LANGUAGE, data.page.slug)}`
	);
</script>

<SEOHead
	title={data.page.title}
	description={data.page.description || undefined}
	{canonicalUrl}
	languages={[DEFAULT_LANGUAGE]}
/>

{#snippet heading({ token, children }: { token: Tokens.Heading; children: Snippet })}
	<svelte:element this={`h${token.depth}`} id={ids.of(token)}>{@render children()}</svelte:element>
{/snippet}

<div class="mx-auto max-w-3xl px-6 pt-16 pb-24 lg:px-12">
	<a href={resolve(localizedHref('/docs'))} class="text-sm text-muted-foreground"
		>{$t('docs.label')}</a
	>
	<article lang="en" class="prose prose-sm max-w-none dark:prose-invert">
		<h1 id={headingSlug(data.page.title)}>{data.page.title}</h1>
		<Streamdown content={data.page.body} baseTheme="shadcn" static {heading} />
	</article>
</div>
