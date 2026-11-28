<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import DocsHeader from '#lib/components/docs/docs-header.svelte';
	import DocsSidebar from '#lib/components/docs/docs-sidebar.svelte';
	import { navSections } from '#lib/docs/navigation.js';
	import { DEFAULT_LANGUAGE } from '#lib/i18n/languages.js';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children?: Snippet } = $props();

	const lang = $derived(page.params.lang ?? DEFAULT_LANGUAGE);
	const currentSlug = $derived(page.params.slug ?? '');
	const sections = $derived(navSections(data.navigation));
</script>

<div class="docs-shell flex min-h-svh-below-notices flex-col bg-background">
	<DocsHeader {sections} {currentSlug} {lang} />
	<main id="main-content" class="flex flex-1 flex-col px-2 selectable">
		<div class="docs-grid flex-1 items-start lg:grid">
			<DocsSidebar {sections} {currentSlug} {lang} />
			<div class="h-full w-full">
				{@render children?.()}
			</div>
		</div>
	</main>
</div>

<style>
	.docs-shell {
		--docs-header-height: 3.5rem;
		--docs-header-bottom: calc(var(--top-notices-height, 0px) + var(--docs-header-height));
	}
	@media (width >= 64rem) {
		.docs-shell {
			--docs-header-height: 4rem;
		}
	}
	.docs-grid {
		grid-template-columns: 18rem minmax(0, 1fr);
	}
</style>
