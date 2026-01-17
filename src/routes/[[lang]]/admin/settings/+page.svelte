<script lang="ts">
	import { T } from '@tolgee/svelte';
	import NotificationRecipientsTable from './notification-recipients-table.svelte';
</script>

<div class="flex flex-col gap-6 px-4 lg:px-6 xl:px-8 2xl:px-16" data-testid="admin-settings-page">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold"><T keyName="admin.settings.title" /></h1>
	</div>

	<!-- Notification Recipients Table -->
	<NotificationRecipientsTable />
</div>
