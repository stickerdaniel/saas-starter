<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	const steps = ['ship', 'talk', 'pay', 'fix'] as const;
</script>

<section class="mx-auto max-w-6xl px-6 pb-30 lg:px-12">
	<h2 class="text-center text-3xl font-semibold text-balance md:text-4xl lg:text-left">
		{$t('after_launch.title')}
	</h2>
	<p class="mt-6 text-center text-balance text-muted-foreground lg:text-left">
		{$t('after_launch.description')}
	</p>
	<ol class="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
		{#each steps as step (step)}
			<li>
				<h3 class="font-medium">{$t(`after_launch.steps.${step}.title`)}</h3>
				<p class="mt-2 text-sm text-muted-foreground">
					{$t(`after_launch.steps.${step}.description`)}
				</p>
			</li>
		{/each}
	</ol>
</section>
