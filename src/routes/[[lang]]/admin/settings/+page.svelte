<script lang="ts">
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import NotificationRecipientsTable from './notification-recipients-table.svelte';

	const { t } = getTranslate();
</script>

<SEOHead
	title={$t('meta.admin.settings.title')}
	description={$t('meta.admin.settings.description')}
/>

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16" data-testid="admin-settings-page">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold"><T keyName="admin.settings.title" /></h1>
	</div>

	<!-- Notification Recipients Table -->
	<NotificationRecipientsTable />
</div>
