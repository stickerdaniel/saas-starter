<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead
	title={$t('meta.app.community_chat.title')}
	description={$t('meta.app.community_chat.description')}
/>
