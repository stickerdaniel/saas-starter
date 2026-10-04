<script lang="ts">
	import { dev } from '$app/environment';
	import { asset } from '$app/paths';
	import { getTranslate } from '@tolgee/svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import ThirdPartyLicenses from '$lib/components/licenses/third-party-licenses.svelte';
	import { CATALOGUE_JSON_FILE, CATALOGUE_TEXT_FILE } from '$lib/licenses/catalogue';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.licenses.title')} description={$t('meta.licenses.description')} />

<div class="mx-auto max-w-3xl space-y-8 px-6 pt-40 pb-24 lg:px-12">
	<div class="prose prose-sm dark:prose-invert">
		<h1>{$t('licenses.title')}</h1>
		<p>{$t('licenses.intro')}</p>
		<!-- A plain link, so the complete notices stay reachable without JavaScript. -->
		<p><a href={asset(`/${CATALOGUE_TEXT_FILE}`)}>{$t('licenses.text_link')}</a></p>
	</div>
	<ThirdPartyLicenses catalogueUrl={asset(`/${CATALOGUE_JSON_FILE}`)} available={!dev} />
</div>
