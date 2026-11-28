<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { UseClipboard } from '#lib/hooks/use-clipboard.svelte.ts';
	import { LazyMenu } from './lazy-menu.svelte.ts';

	let { markdownPath, pageUrl }: { markdownPath: string; pageUrl: string } = $props();

	const { t } = getTranslate();
	const clipboard = new UseClipboard({ delay: 2000 });
	const actions = new LazyMenu(() => import('./docs-page-actions.svelte'));

	function copyPage() {
		void clipboard.copy(
			fetch(resolve(markdownPath)).then((response) =>
				response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))
			)
		);
	}
</script>

{#snippet button(props: Record<string, unknown>)}
	<Button {...props} variant="secondary" size="icon-sm" aria-label={$t('docs.page_actions')}>
		<ChevronDownIcon aria-hidden="true" />
	</Button>
{/snippet}

<div class="hidden items-center rounded-lg bg-secondary md:flex">
	<Button variant="secondary" size="sm" onclick={copyPage}>
		{#if clipboard.copied}
			<CheckIcon aria-hidden="true" />
		{:else}
			<CopyIcon aria-hidden="true" />
		{/if}
		{$t('docs.copy_page')}
	</Button>
	<Separator decorative orientation="vertical" class="h-4!" />
	{#if actions.menu}
		<actions.menu
			bind:open={actions.open}
			bind:trigger={actions.trigger}
			openedWithKeyboard={actions.pending === 'keyboard'}
			{button}
			{markdownPath}
			{pageUrl}
		/>
	{:else}
		{@render button(actions.standIn)}
	{/if}
</div>
