<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import type { DocsNavSection } from '#lib/docs/navigation.js';
	import { docsPath } from '#lib/docs/urls.js';
	import type { DocsHeaderLink } from './docs-header.svelte';

	let {
		links,
		sections,
		currentSlug,
		lang,
		onnavigate
	}: {
		links: readonly DocsHeaderLink[];
		sections: readonly DocsNavSection[];
		currentSlug: string;
		lang: string;
		onnavigate?: () => void;
	} = $props();

	const { t } = getTranslate();
</script>

<nav aria-label={$t('docs.label')} class="flex flex-col gap-12 p-6">
	<div class="flex flex-col gap-4">
		<p class="text-sm font-medium text-muted-foreground">{$t('docs.menu')}</p>
		<ul class="flex flex-col gap-3">
			{#each links as link (link.path)}
				<li>
					<a
						href={resolve(link.path)}
						aria-current={link.current ? 'page' : undefined}
						class="text-2xl font-medium"
						onclick={onnavigate}
					>
						{link.label}
					</a>
				</li>
			{/each}
		</ul>
	</div>
	{#each sections as group (group.section)}
		<div class="flex flex-col gap-4">
			<p class="text-sm font-medium text-muted-foreground">{group.section}</p>
			<ul class="flex flex-col gap-3">
				{#each group.entries as entry (entry.slug)}
					<li>
						<a
							href={resolve(docsPath(lang, entry.slug))}
							aria-current={entry.slug === currentSlug ? 'page' : undefined}
							class="text-2xl font-medium"
							onclick={onnavigate}
						>
							{entry.title}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</nav>
