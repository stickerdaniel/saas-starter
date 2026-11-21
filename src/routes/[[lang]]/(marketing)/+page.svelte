<script>
	import SEOHead from '#lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import HeroFive from '#blocks/hero/hero-five.svelte';
	import IntegrationOne from '#blocks/integration/integration-one.svelte';
	import AfterLaunchOne from '#blocks/after-launch/after-launch-one.svelte';
	import FaqOne from '#blocks/faq/faq-one.svelte';
	import LazyCustomerSupport from '#lib/components/customer-support/lazy-customer-support.svelte';
	const { t } = getTranslate();
</script>

<SEOHead
	title={$t('meta.home.title')}
	description={$t('meta.home.description')}
	siteStructuredData
/>
<LazyCustomerSupport />

<HeroFive />
<IntegrationOne />
<AfterLaunchOne />
<FaqOne />
