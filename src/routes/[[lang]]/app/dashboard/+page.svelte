<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead
	title={$t('meta.app.dashboard.title')}
	description={$t('meta.app.dashboard.description')}
/>

<div class="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
	<h1 class="text-3xl font-bold tracking-tight">
		<T keyName="app.dashboard.title" />
	</h1>
	<p class="max-w-md text-muted-foreground">
		<T keyName="app.dashboard.subtitle" />
	</p>
</div>
