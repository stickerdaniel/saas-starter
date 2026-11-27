<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import type { DocsNavSection } from '#lib/docs/navigation.js';
	import { docsPath } from '#lib/docs/urls.js';

	let {
		sections,
		currentSlug,
		lang
	}: { sections: readonly DocsNavSection[]; currentSlug: string; lang: string } = $props();

	const { t } = getTranslate();
</script>

<nav aria-label={$t('docs.label')} class="rail sticky z-30 hidden w-72 overflow-hidden lg:flex">
	<div
		aria-hidden="true"
		class="absolute top-12 right-2 bottom-0 w-px bg-linear-to-b from-transparent via-border to-transparent"
	></div>
	<div class="no-scrollbar flex w-56 flex-col overflow-y-auto ps-2.5">
		{#each sections as group (group.section)}
			<div class="flex flex-col p-2 first:pt-12">
				<p class="flex h-8 items-center px-2 text-xs font-medium text-muted-foreground">
					{group.section}
				</p>
				<ul class="flex flex-col gap-0.5">
					{#each group.entries as entry (entry.slug)}
						<li>
							<a
								href={resolve(docsPath(lang, entry.slug))}
								aria-current={entry.slug === currentSlug ? 'page' : undefined}
								class="inline-flex h-7.5 w-fit items-center rounded-md border border-transparent p-2 text-nav font-medium text-sidebar-foreground hover:bg-accent/65 aria-[current=page]:border-accent aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
							>
								{entry.title}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
</nav>

<style>
	.rail {
		top: calc(var(--docs-header-bottom) + 0.6rem);
		height: calc(100svh - var(--docs-header-bottom) - 6rem);
	}
</style>
