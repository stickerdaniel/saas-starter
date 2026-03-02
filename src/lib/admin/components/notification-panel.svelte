<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { getTranslate } from '@tolgee/svelte';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import CheckCheckIcon from '@lucide/svelte/icons/check-check';
	import NotificationBell from './notification-bell.svelte';
	import NotificationItem from './notification-item.svelte';

	const { t } = getTranslate();
	const client = useConvexClient();

	const unreadCountQuery = useQuery(api.adminFramework.notifications.unreadCount, {});
	const notificationsQuery = useQuery(api.adminFramework.notifications.listNotifications, {
		numItems: 20
	});

	const unreadCount = $derived(unreadCountQuery.data ?? 0);
	const notifications = $derived(notificationsQuery.data?.items ?? []);
	const isLoading = $derived(notificationsQuery.isLoading);

	async function markAsRead(id: string) {
		await client.mutation(api.adminFramework.notifications.markAsRead, {
			id: id as any
		});
	}

	async function markAsUnread(id: string) {
		await client.mutation(api.adminFramework.notifications.markAsUnread, {
			id: id as any
		});
	}

	async function markAllAsRead() {
		await client.mutation(api.adminFramework.notifications.markAllAsRead, {});
	}

	async function deleteNotification(id: string) {
		await client.mutation(api.adminFramework.notifications.deleteNotification, {
			id: id as any
		});
	}
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<span {...props}>
				<NotificationBell {unreadCount} />
			</span>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-96 p-0" data-testid="admin-notifications-panel">
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3">
			<h3 class="text-sm font-semibold">{$t('admin.notifications.title')}</h3>
			{#if unreadCount > 0}
				<Button variant="ghost" size="sm" class="h-7 text-xs" onclick={markAllAsRead}>
					<CheckCheckIcon class="mr-1 size-3.5" />
					{$t('admin.notifications.mark_all_read')}
				</Button>
			{/if}
		</div>
		<Separator />

		<!-- Notification list -->
		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<div
					class="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent"
				></div>
			</div>
		{:else if notifications.length === 0}
			<Empty.Root class="py-8">
				<Empty.Media>
					<BellOffIcon class="text-muted-foreground size-10" />
				</Empty.Media>
				<Empty.Title>{$t('admin.notifications.no_notifications')}</Empty.Title>
				<Empty.Description
					>{$t('admin.notifications.no_notifications_description')}</Empty.Description
				>
			</Empty.Root>
		{:else}
			<ScrollArea class="max-h-96">
				<div class="py-1">
					{#each notifications as notification (notification._id)}
						<NotificationItem
							{notification}
							onMarkRead={markAsRead}
							onMarkUnread={markAsUnread}
							onDelete={deleteNotification}
						/>
					{/each}
				</div>
			</ScrollArea>
		{/if}
	</Popover.Content>
</Popover.Root>
