<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import type { DocsNavSection } from '#lib/docs/navigation.js';
	import { cn } from '#lib/utils.js';
	import type { DocsHeaderLink } from './docs-header.svelte';
	import DocsMobileLinks from './docs-mobile-links.svelte';
	import { LazyMenu } from './lazy-menu.svelte.ts';

	let {
		links,
		sections,
		currentSlug,
		lang
	}: {
		links: readonly DocsHeaderLink[];
		sections: readonly DocsNavSection[];
		currentSlug: string;
		lang: string;
	} = $props();

	const { t } = getTranslate();
	const menu = new LazyMenu(() => import('./docs-mobile-menu.svelte'), 'dialog');
</script>

<svelte:head>
	<noscript>
		<style>
			[data-docs-menu-stand-in] {
				display: none !important;
			}
		</style>
	</noscript>
</svelte:head>

{#snippet button(props: Record<string, unknown>)}
	<Button {...props} variant="ghost" size="sm" class="-ms-2.5 lg:hidden">
		<span aria-hidden="true" class="relative block size-4">
			<span
				class={[
					'absolute left-0 block h-0.5 w-4 bg-foreground transition-transform duration-100 motion-reduce:transition-none',
					menu.open ? 'top-1.5 -rotate-45' : 'top-1'
				]}
			></span>
			<span
				class={[
					'absolute left-0 block h-0.5 w-4 bg-foreground transition-transform duration-100 motion-reduce:transition-none',
					menu.open ? 'top-1.5 rotate-45' : 'top-2.5'
				]}
			></span>
		</span>
		{$t('docs.menu')}
	</Button>
{/snippet}

{#if menu.menu}
	<menu.menu
		bind:open={menu.open}
		bind:trigger={menu.trigger}
		openedWithKeyboard={menu.pending === 'keyboard'}
		{button}
		{links}
		{sections}
		{currentSlug}
		{lang}
	/>
{:else}
	{@render button({ ...menu.standIn, 'data-docs-menu-stand-in': '' })}
{/if}

<noscript>
	<details class="lg:hidden">
		<summary
			class={cn(
				buttonVariants({ variant: 'ghost', size: 'sm' }),
				'-ms-2.5 list-none [&::-webkit-details-marker]:hidden'
			)}
		>
			{$t('docs.menu')}
		</summary>
		<div
			class="docs-noscript-menu fixed inset-x-0 bottom-0 z-50 overflow-y-auto bg-background text-foreground"
		>
			<DocsMobileLinks {links} {sections} {currentSlug} {lang} />
		</div>
	</details>
</noscript>

<style>
	:global(.docs-noscript-menu) {
		top: var(--docs-header-bottom);
	}
</style>
