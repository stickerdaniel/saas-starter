<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	const items = ['free', 'accounts', 'hosting', 'updates', 'production', 'agents'] as const;
</script>

<section class="mx-auto max-w-6xl px-6 pb-30 lg:px-12">
	<h2 class="text-center text-3xl font-semibold text-balance md:text-4xl lg:text-left">
		{$t('faq.title')}
	</h2>
	<dl class="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
		{#each items as item (item)}
			<div>
				<dt class="font-medium">{$t(`faq.items.${item}.question`)}</dt>
				<dd class="mt-2 text-sm text-muted-foreground">{$t(`faq.items.${item}.answer`)}</dd>
			</div>
		{/each}
	</dl>
</section>
