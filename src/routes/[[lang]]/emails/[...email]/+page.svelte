<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import EmailPreview from 'better-svelte-email/preview/EmailPreview.svelte';
	import { page } from '$app/stores';

	const { t } = getTranslate();
</script>

<SEOHead
	title={$t('meta.emails.preview.title')}
	description={$t('meta.emails.preview.description')}
/>

<EmailPreview page={$page} />
