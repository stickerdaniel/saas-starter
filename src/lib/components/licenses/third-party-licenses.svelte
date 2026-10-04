<script lang="ts">
	import { onMount } from 'svelte';
	import * as v from 'valibot';
	import { getTranslate } from '@tolgee/svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import {
		catalogueSchema,
		filterCatalogueEntries,
		type CatalogueEntry
	} from '$lib/licenses/catalogue';

	interface Props {
		/** URL of the generated catalogue JSON. */
		catalogueUrl: string;
		/** False in development, where no build has generated the catalogue. */
		available?: boolean;
	}

	let { catalogueUrl, available = true }: Props = $props();

	const { t } = getTranslate();

	// Known component labels from the build tool; unknown ones render verbatim.
	const COMPONENT_KEYS: Record<string, string> = {
		client: 'licenses.components.client',
		'client-worker': 'licenses.components.client_worker',
		styles: 'licenses.components.styles',
		assets: 'licenses.components.assets',
		fonts: 'licenses.components.fonts'
	};

	let status = $state<'loading' | 'error' | 'ready'>('loading');
	let entries = $state.raw<CatalogueEntry[]>([]);
	let query = $state('');
	const results = $derived(filterCatalogueEntries(entries, query));
	// Notice texts render only while their row is open, which keeps the page light.
	const expanded = $state<Record<string, boolean>>({});
	let controller: AbortController | null = null;

	function componentLabel(component: string): string {
		const key = COMPONENT_KEYS[component];
		return key ? $t(key) : component;
	}

	function summary(entry: CatalogueEntry): string {
		return [entry.version, entry.license, entry.components.map(componentLabel).join(', ')]
			.filter(Boolean)
			.join(' · ');
	}

	async function load() {
		controller?.abort();
		const current = new AbortController();
		controller = current;
		status = 'loading';
		try {
			const response = await fetch(catalogueUrl, { cache: 'no-cache', signal: current.signal });
			if (!response.ok) throw new Error(`Catalogue request failed with ${response.status}`);
			const catalogue = v.parse(catalogueSchema, await response.json());
			if (current.signal.aborted) return;
			entries = catalogue.entries;
			status = 'ready';
		} catch {
			if (current.signal.aborted) return;
			status = 'error';
		}
	}

	onMount(() => {
		if (available) void load();
		return () => controller?.abort();
	});
</script>

<section class="space-y-4">
	{#if !available}
		<p class="text-sm text-muted-foreground">{$t('licenses.unavailable')}</p>
	{:else if status === 'loading'}
		<p role="status" class="text-sm text-muted-foreground">{$t('licenses.loading')}</p>
	{:else if status === 'error'}
		<div role="alert" class="flex flex-col items-start gap-3">
			<p class="text-sm">{$t('licenses.error')}</p>
			<Button variant="outline" size="sm" onclick={() => load()}>{$t('licenses.retry')}</Button>
		</div>
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
				{#each results as entry (entry.id)}
					<li>
						<Collapsible.Root
							bind:open={() => expanded[entry.id] ?? false, (open) => (expanded[entry.id] = open)}
						>
							<Collapsible.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										class="group flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
									>
										<span class="min-w-0 flex-1">
											<span class="block font-medium break-words">{entry.name}</span>
											<span class="block text-xs text-muted-foreground">{summary(entry)}</span>
										</span>
										<ChevronDownIcon
											class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
											aria-hidden="true"
										/>
									</button>
								{/snippet}
							</Collapsible.Trigger>
							<Collapsible.Content>
								<div class="space-y-4 px-4 pb-4">
									{#if expanded[entry.id]}
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
									{/if}
								</div>
							</Collapsible.Content>
						</Collapsible.Root>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
