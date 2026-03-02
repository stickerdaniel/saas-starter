<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getTranslate } from '@tolgee/svelte';

	type Props = {
		lines?: number;
		children: Snippet;
	};

	let { lines = 3, children }: Props = $props();

	const { t } = getTranslate();

	let expanded = $state(false);
	let contentEl: HTMLDivElement | undefined = $state();
	let needsExpand = $state(false);

	const collapsedHeight = $derived(`${lines * 1.5}rem`);

	$effect(() => {
		if (contentEl) {
			const lineHeight = parseFloat(getComputedStyle(contentEl).lineHeight) || 24;
			needsExpand = contentEl.scrollHeight > lineHeight * lines + 2;
		}
	});
</script>

<div class="expandable-content relative">
	<div
		bind:this={contentEl}
		class="overflow-hidden transition-[max-height] duration-300 ease-in-out motion-reduce:transition-none"
		style:max-height={expanded || !needsExpand ? 'none' : collapsedHeight}
	>
		{@render children()}
	</div>

	{#if !expanded && needsExpand}
		<div
			class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent"
		></div>
	{/if}

	{#if needsExpand}
		<button
			type="button"
			class="mt-1 text-xs font-medium text-primary hover:underline"
			onclick={() => (expanded = !expanded)}
		>
			{expanded ? $t('admin.resources.form.hide_content') : $t('admin.resources.form.show_content')}
		</button>
	{/if}
</div>
