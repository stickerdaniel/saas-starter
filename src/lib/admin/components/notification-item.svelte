<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getTranslate } from '@tolgee/svelte';

	type ParamValue = string | number | bigint | boolean | Date | null | undefined;

	interface Notification {
		_id: string;
		type: 'success' | 'error' | 'warning' | 'info';
		message: string;
		messageParams?: Record<string, ParamValue>;
		actionText?: string;
		actionUrl?: string;
		openInNewTab?: boolean;
		readAt?: number;
		createdAt: number;
		[key: string]: unknown;
	}

	interface Props {
		notification: Notification;
		onMarkRead: (id: string) => void;
		onMarkUnread: (id: string) => void;
		onDelete: (id: string) => void;
	}

	let { notification, onMarkRead, onMarkUnread, onDelete }: Props = $props();

	const { t } = getTranslate();

	const isUnread = $derived(notification.readAt === undefined);

	const typeColors: Record<string, string> = {
		success: 'text-emerald-500',
		error: 'text-destructive',
		warning: 'text-amber-500',
		info: 'text-blue-500'
	};

	const iconColor = $derived(typeColors[notification.type] ?? 'text-muted-foreground');

	function formatRelativeTime(timestamp: number): string {
		const now = Date.now();
		const diffMs = now - timestamp;
		const diffSec = Math.floor(diffMs / 1000);
		const diffMin = Math.floor(diffSec / 60);
		const diffHour = Math.floor(diffMin / 60);
		const diffDay = Math.floor(diffHour / 24);

		if (diffSec < 60) return '<1m';
		if (diffMin < 60) return `${diffMin}m`;
		if (diffHour < 24) return `${diffHour}h`;
		if (diffDay < 30) return `${diffDay}d`;
		return new Date(timestamp).toLocaleDateString();
	}

	function handleClick() {
		if (isUnread) {
			onMarkRead(notification._id);
		}
		if (notification.actionUrl) {
			if (notification.openInNewTab) {
				window.open(notification.actionUrl, '_blank');
			} else {
				goto(resolve(notification.actionUrl));
			}
		}
	}
</script>

<button
	type="button"
	class="hover:bg-accent flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors {isUnread
		? 'bg-accent/50'
		: ''}"
	onclick={handleClick}
	data-testid="admin-notification-item"
>
	<!-- Type icon -->
	<div class="mt-0.5 shrink-0 {iconColor}">
		{#if notification.type === 'success'}
			<CircleCheckIcon class="size-4" />
		{:else if notification.type === 'error'}
			<CircleAlertIcon class="size-4" />
		{:else if notification.type === 'warning'}
			<TriangleAlertIcon class="size-4" />
		{:else}
			<InfoIcon class="size-4" />
		{/if}
	</div>

	<!-- Content -->
	<div class="min-w-0 flex-1">
		<p class="text-sm leading-snug {isUnread ? 'font-medium' : 'text-muted-foreground'}">
			{$t(notification.message, notification.messageParams ?? {})}
		</p>
		<div class="mt-1 flex items-center gap-2">
			<span class="text-muted-foreground text-xs">{formatRelativeTime(notification.createdAt)}</span
			>
			{#if notification.actionText}
				<span class="text-xs text-blue-500 flex items-center gap-0.5">
					{notification.actionText}
					{#if notification.openInNewTab}
						<ExternalLinkIcon class="size-3" />
					{/if}
				</span>
			{/if}
		</div>
	</div>

	<!-- Actions -->
	<div class="flex shrink-0 items-center gap-0.5">
		{#if isUnread}
			<!-- Unread dot + mark read -->
			<Button
				variant="ghost"
				size="icon"
				class="size-7"
				onclick={(e: MouseEvent) => {
					e.stopPropagation();
					onMarkRead(notification._id);
				}}
			>
				<CircleIcon class="size-2.5 fill-blue-500 text-blue-500" />
				<span class="sr-only">{$t('admin.notifications.mark_read')}</span>
			</Button>
		{:else}
			<!-- Mark unread -->
			<Button
				variant="ghost"
				size="icon"
				class="size-7"
				onclick={(e: MouseEvent) => {
					e.stopPropagation();
					onMarkUnread(notification._id);
				}}
			>
				<CheckIcon class="text-muted-foreground size-3.5" />
				<span class="sr-only">{$t('admin.notifications.mark_unread')}</span>
			</Button>
		{/if}
		<Button
			variant="ghost"
			size="icon"
			class="size-7"
			onclick={(e: MouseEvent) => {
				e.stopPropagation();
				onDelete(notification._id);
			}}
		>
			<TrashIcon class="text-muted-foreground size-3.5" />
			<span class="sr-only">{$t('admin.notifications.delete')}</span>
		</Button>
	</div>
</button>
