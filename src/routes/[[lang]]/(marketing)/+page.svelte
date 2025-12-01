<script>
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import HeroFive from '$blocks/hero/hero-five.svelte';
	import IntegrationOne from '$blocks/integration/integration-one.svelte';
	import CustomerSupport from '$lib/components/customer-support/customer-support.svelte';
	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.home.title')} description={$t('meta.home.description')} />
<CustomerSupport />

<HeroFive />
<IntegrationOne />
