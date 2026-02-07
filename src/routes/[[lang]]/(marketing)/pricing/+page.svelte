<script lang="ts">
	import PricingThree from '$blocks/pricing/pricing-three.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.pricing.title')} description={$t('meta.pricing.description')} />

<PricingThree />
