<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	// This page redirects to /admin/dashboard via +page.server.ts
</script>

<SEOHead title={$t('meta.admin.home.title')} description={$t('meta.admin.home.description')} />
