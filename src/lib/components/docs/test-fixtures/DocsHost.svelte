<script lang="ts">
	import { FormatSimple, TolgeeCore, TolgeeProvider } from '@tolgee/svelte';
	import en from '../../../../i18n/en.json';
	import { setGlobalSearchContext } from '#lib/components/global-search/context.svelte.ts';
	import type { DocsNavEntry, DocsPageView } from '#lib/docs/engine.js';
	import { navSections } from '#lib/docs/navigation.js';
	import DocsHeader from '../docs-header.svelte';
	import DocsPage from '../docs-page.svelte';
	import DocsSidebar from '../docs-sidebar.svelte';

	let { page, navigation }: { page: DocsPageView; navigation: DocsNavEntry[] } = $props();

	const tolgee = TolgeeCore().use(FormatSimple()).init({ language: 'en', staticData: { en } });
	setGlobalSearchContext();
	const sections = $derived(navSections(navigation));
</script>

<TolgeeProvider {tolgee}>
	<DocsHeader {sections} currentSlug={page.slug} lang="en" />
	<main>
		<DocsSidebar {sections} currentSlug={page.slug} lang="en" />
		<DocsPage {page} lang="en" origin="https://example.com" />
	</main>
</TolgeeProvider>
