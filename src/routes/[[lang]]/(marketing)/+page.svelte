<script>
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import HeroFive from '$blocks/hero/hero-five.svelte';
	import IntegrationOne from '$blocks/integration/integration-one.svelte';
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.home.title')} description={$t('meta.home.description')} />

<AIChatbar />
<FeedbackButton />
<HeroFive />
<IntegrationOne />
