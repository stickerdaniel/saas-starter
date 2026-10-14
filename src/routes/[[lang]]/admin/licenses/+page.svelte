<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import SEOHead from '#lib/components/SEOHead.svelte';
	import ThirdPartyLicenses from '#lib/components/licenses/third-party-licenses.svelte';

	let { data } = $props();

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.licenses.title')} description={$t('meta.licenses.description')} noindex />

<div class="px-4 lg:px-6 xl:px-8 2xl:px-16">
	<ThirdPartyLicenses entries={data.entries} />
</div>
