<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.app.home.title')} description={$t('meta.app.home.description')} />
