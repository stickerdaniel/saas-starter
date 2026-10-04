<script lang="ts">
	import { asset } from '$app/paths';
	import { getTranslate } from '@tolgee/svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import {
		CATALOGUE_TEXT_FILE,
		filterCatalogueEntries,
		noticesText,
		type CatalogueEntry
	} from '$lib/licenses/catalogue';

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
	const results = $derived(filterCatalogueEntries(entries ?? [], query, componentLabel));
	const searching = $derived(query.trim() !== '');
	const downloadLabel = $derived(
		searching
			? $t('licenses.download_results', { count: results.length })
			: $t('licenses.text_link')
	);

	function componentLabel(component: string): string {
		const key = COMPONENT_KEYS[component];
		return key ? $t(key) : component;
	}

	// Without a search, or without JavaScript, the link serves the published file.
	function downloadResults(event: MouseEvent) {
		if (!searching) return;
		event.preventDefault();
		if (results.length === 0) return;
		const blob = new Blob([noticesText(results, query.trim())], {
			type: 'text/plain;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = CATALOGUE_TEXT_FILE.replace(/\.txt$/, '-search.txt');
		link.click();
		setTimeout(() => URL.revokeObjectURL(url));
	}
</script>

<section class="space-y-4">
	{#if !entries}
		<p class="text-sm text-muted-foreground">{$t('licenses.unavailable')}</p>
	{:else}
		<div class="space-y-2">
			<Label for="third-party-license-search">{$t('licenses.search.label')}</Label>
			<div class="flex gap-2">
				<Input
					id="third-party-license-search"
					type="search"
					autocomplete="off"
					placeholder={$t('licenses.search.placeholder')}
					bind:value={query}
				/>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<a
								{...props}
								href={asset(`/${CATALOGUE_TEXT_FILE}`)}
								download={CATALOGUE_TEXT_FILE}
								aria-label={downloadLabel}
								aria-disabled={searching && results.length === 0 ? 'true' : undefined}
								class={buttonVariants({
									variant: 'outline',
									size: 'icon',
									class: 'aria-disabled:opacity-50'
								})}
								onclick={downloadResults}
							>
								<DownloadIcon aria-hidden="true" />
							</a>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>{downloadLabel}</Tooltip.Content>
				</Tooltip.Root>
			</div>
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
									<span class="font-medium break-words">{entry.name}</span>
									{#if entry.version}
										<span class="ml-1.5 text-xs text-muted-foreground">{entry.version}</span>
									{/if}
									<span class="mt-1.5 flex flex-wrap gap-1.5">
										<Badge variant="secondary">{entry.license}</Badge>
										{#each entry.components as component (component)}
											<Badge variant="outline">{componentLabel(component)}</Badge>
										{/each}
									</span>
								</span>
								<ChevronDownIcon
									class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
									aria-hidden="true"
								/>
							</summary>
							<div class="space-y-4 px-4 pb-4">
								<!-- Notice texts are legal texts and stay in their original English. -->
								{#each entry.notices as notice, index (index)}
									<div class="space-y-1">
										<div class="flex items-baseline justify-between gap-4">
											<p lang="en" class="text-xs font-medium text-muted-foreground">
												{notice.label}
											</p>
											{#if index === 0 && entry.sourceUrl}
												<a
													href={entry.sourceUrl}
													target="_blank"
													rel="external noopener noreferrer"
													class="text-xs underline underline-offset-4"
												>
													{$t('licenses.source')}
												</a>
											{/if}
										</div>
										<pre
											lang="en"
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
