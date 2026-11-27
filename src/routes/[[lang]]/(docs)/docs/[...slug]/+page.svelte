<script lang="ts">
	import { page } from '$app/state';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import DocsPage from '#lib/components/docs/docs-page.svelte';
	import { resolveSiteOrigin } from '#lib/config/site-origin.js';
	import { docsPath } from '#lib/docs/urls.js';
	import { DEFAULT_LANGUAGE } from '#lib/i18n/languages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const origin = $derived(resolveSiteOrigin(page.url.origin));
</script>

<SEOHead
	title={data.page.title}
	description={data.page.description || undefined}
	canonicalUrl="{origin}{docsPath(DEFAULT_LANGUAGE, data.page.slug)}"
	languages={[DEFAULT_LANGUAGE]}
/>

<DocsPage page={data.page} lang={page.params.lang ?? DEFAULT_LANGUAGE} {origin} />
