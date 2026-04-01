<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';
	import { page } from '$app/state';
	import { dev } from '$app/environment';

	const { t } = getTranslate();

	let EmailPreview:
		| typeof import('better-svelte-email/preview/EmailPreview.svelte').default
		| undefined = $state();

	if (dev) {
		import('better-svelte-email/preview/EmailPreview.svelte').then((m) => {
			EmailPreview = m.default;
		});
	}
</script>

<SEOHead
	title={$t('meta.emails.preview.title')}
	description={$t('meta.emails.preview.description')}
/>

{#if EmailPreview}
	<EmailPreview {page} />
{/if}
