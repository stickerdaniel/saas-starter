<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { DocsPageView } from '#lib/docs/engine.js';
	import { headingSlug } from '#lib/docs/headings.js';
	import { docsPath } from '#lib/docs/urls.js';
	import DocsCopyPage from './docs-copy-page.svelte';
	import DocsMarkdown from './docs-markdown.svelte';
	import DocsToc from './docs-toc.svelte';

	let { page, lang, origin }: { page: DocsPageView; lang: string; origin: string } = $props();

	const { t } = getTranslate();
</script>

<div class="docs-page flex flex-row-reverse items-stretch xl:w-full">
	<aside class="toc sticky z-30 ms-auto hidden w-72 flex-col gap-4 overflow-hidden pb-8 xl:flex">
		<div class="no-scrollbar flex flex-col gap-8 overflow-y-auto px-8">
			<DocsToc headings={page.headings} />
		</div>
	</aside>
	<div class="flex min-w-0 flex-1 flex-col">
		<div aria-hidden="true" class="h-0 shrink-0 lg:h-4"></div>
		<div
			class="mx-auto flex w-full max-w-160 min-w-0 flex-1 flex-col gap-6 px-4 py-6 text-foreground md:px-0 lg:py-8"
		>
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between gap-2 md:items-start">
					<h1 id={headingSlug(page.title)} class="title text-3xl font-semibold tracking-tight">
						{page.title}
					</h1>
					<div class="flex items-center gap-2">
						<DocsCopyPage
							markdownPath={docsPath(lang, page.slug, 'markdown')}
							pageUrl="{origin}{docsPath(lang, page.slug)}"
						/>
						{#if page.previous}
							<Button
								variant="secondary"
								size="icon-sm"
								href={resolve(docsPath(lang, page.previous.slug))}
								aria-label={$t('table.pagination.previous')}
							>
								<ArrowLeftIcon aria-hidden="true" />
							</Button>
						{/if}
						{#if page.next}
							<Button
								variant="secondary"
								size="icon-sm"
								href={resolve(docsPath(lang, page.next.slug))}
								aria-label={$t('table.pagination.next')}
							>
								<ArrowRightIcon aria-hidden="true" />
							</Button>
						{/if}
					</div>
				</div>
				{#if page.lead}
					<p lang="en" class="text-muted-foreground sm:text-base sm:text-balance md:max-w-4/5">
						<DocsMarkdown content={page.lead} title={page.title} inline />
					</p>
				{/if}
			</div>
			<article lang="en" class="w-full flex-1 pb-16 sm:pb-0">
				<DocsMarkdown content={page.body} title={page.title} highlights={page.code} />
			</article>
			<div class="hidden h-16 w-full items-center gap-2 sm:flex">
				{#if page.previous}
					<Button variant="secondary" size="sm" href={resolve(docsPath(lang, page.previous.slug))}>
						<ArrowLeftIcon aria-hidden="true" />
						{page.previous.title}
					</Button>
				{/if}
				{#if page.next}
					<Button
						variant="secondary"
						size="sm"
						href={resolve(docsPath(lang, page.next.slug))}
						class="ms-auto"
					>
						{page.next.title}
						<ArrowRightIcon aria-hidden="true" />
					</Button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.docs-page {
		font-size: 1.05rem;
	}
	@media (width >= 40rem) {
		.docs-page {
			font-size: 15px;
		}
	}
	.title {
		scroll-margin-top: calc(var(--docs-header-bottom) + var(--spacing) * 8);
	}
	.toc {
		top: calc(var(--docs-header-bottom) + 1px);
		height: 90svh;
	}
</style>
