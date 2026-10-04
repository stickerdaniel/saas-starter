<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { filterCatalogueEntries, type CatalogueEntry } from '$lib/licenses/catalogue';

	interface Props {
		/** Catalogue rows from the build; null in development, where no build collected them. */
		entries: CatalogueEntry[] | null;
	}

	let { entries }: Props = $props();

	const { t } = getTranslate();

	// Known component labels from the build tool; unknown ones render verbatim.
	const COMPONENT_KEYS: Record<string, string> = {
		client: 'licenses.components.client',
		'client-worker': 'licenses.components.client_worker',
		styles: 'licenses.components.styles',
		assets: 'licenses.components.assets',
		fonts: 'licenses.components.fonts'
	};

	let query = $state('');
	const results = $derived(filterCatalogueEntries(entries ?? [], query));

	function componentLabel(component: string): string {
		const key = COMPONENT_KEYS[component];
		return key ? $t(key) : component;
	}

	function summary(entry: CatalogueEntry): string {
		return [entry.version, entry.license, entry.components.map(componentLabel).join(', ')]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<section class="space-y-4">
	{#if !entries}
		<p class="text-sm text-muted-foreground">{$t('licenses.unavailable')}</p>
	{:else}
		<div class="space-y-2">
			<Label for="third-party-license-search">{$t('licenses.search.label')}</Label>
			<Input
				id="third-party-license-search"
				type="search"
				autocomplete="off"
				placeholder={$t('licenses.search.placeholder')}
				bind:value={query}
			/>
		</div>
		<p role="status" class="text-sm text-muted-foreground">
			{$t('licenses.results', { count: results.length })}
		</p>
		{#if results.length > 0}
			<ul class="divide-y rounded-lg ring-1 ring-foreground/10">
				<!-- Native disclosure: rows open without JavaScript and before hydration. -->
				{#each results as entry (entry.id)}
					<li>
						<details class="group">
							<summary
								class="flex w-full cursor-pointer list-none items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
							>
								<span class="min-w-0 flex-1">
									<span class="block font-medium break-words">{entry.name}</span>
									<span class="block text-xs text-muted-foreground">{summary(entry)}</span>
								</span>
								<ChevronDownIcon
									class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
									aria-hidden="true"
								/>
							</summary>
							<div class="space-y-4 px-4 pb-4">
								{#if entry.sourceUrl}
									<a
										href={entry.sourceUrl}
										target="_blank"
										rel="external noopener noreferrer"
										class="text-sm underline underline-offset-4"
									>
										{$t('licenses.source')}
									</a>
								{/if}
								<!-- Notice texts are legal texts and stay in their original English. -->
								{#each entry.notices as notice, index (index)}
									<div lang="en" class="space-y-1">
										<p class="text-xs font-medium text-muted-foreground">{notice.label}</p>
										<pre
											class="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs break-words whitespace-pre-wrap">{notice.text}</pre>
									</div>
								{/each}
							</div>
						</details>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
