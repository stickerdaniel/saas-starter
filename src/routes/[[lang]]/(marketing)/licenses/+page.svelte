<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import ThirdPartyLicenses from '$lib/components/licenses/third-party-licenses.svelte';

	let { data } = $props();

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.licenses.title')} description={$t('meta.licenses.description')} />

<div class="mx-auto max-w-3xl space-y-8 px-6 pt-40 pb-24 lg:px-12">
	<div class="prose prose-sm dark:prose-invert">
		<h1>{$t('licenses.title')}</h1>
		<p>{$t('licenses.intro')}</p>
	</div>
	<ThirdPartyLicenses entries={data.entries} />
</div>
