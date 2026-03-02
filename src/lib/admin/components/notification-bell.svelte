<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import BellIcon from '@lucide/svelte/icons/bell';
	import { getTranslate } from '@tolgee/svelte';

	interface Props {
		unreadCount: number;
	}

	let { unreadCount }: Props = $props();

	const { t } = getTranslate();

	const displayCount = $derived(unreadCount > 99 ? '99+' : String(unreadCount));
</script>

<Button variant="ghost" size="icon" class="relative size-8" data-testid="admin-notifications-bell">
	<BellIcon class="size-4" />
	{#if unreadCount > 0}
		<span
			class="bg-destructive text-destructive-foreground pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium"
		>
			{displayCount}
		</span>
	{/if}
	<span class="sr-only">{$t('admin.notifications.bell_label')}</span>
</Button>
