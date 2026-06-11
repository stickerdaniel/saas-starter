<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import LockIcon from '@lucide/svelte/icons/lock';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let {
		isPro = false,
		hasMessagesAvailable = false,
		remaining = 0,
		total = 0,
		onUpgrade,
		isUpgrading = false
	}: {
		isPro?: boolean;
		hasMessagesAvailable?: boolean;
		remaining?: number;
		total?: number;
		onUpgrade?: () => void;
		isUpgrading?: boolean;
	} = $props();

	// Low when a third or less of the quota remains. The isFinite guard makes
	// this a no-op for unlimited quotas (total = Infinity).
	const isLow = $derived(
		Number.isFinite(total) && total > 0 && remaining > 0 && remaining / total <= 1 / 3
	);
</script>

{#if !hasMessagesAvailable}
	<!-- Out of messages: free users get an upgrade CTA, Pro users an info notice -->
	<div
		class="mx-4 mb-2 flex items-center justify-between rounded-lg border border-border/50 bg-muted/50 px-4 py-3 backdrop-blur-sm"
	>
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<LockIcon class="size-4 shrink-0" />
			<span>
				<T keyName={isPro ? 'chat.alerts.limit_reached_pro' : 'chat.alerts.limit_reached_free'} />
			</span>
		</div>
		{#if !isPro}
			<Button size="sm" variant="default" onclick={onUpgrade} disabled={isUpgrading}>
				{isUpgrading ? $t('chat.buttons.processing') : $t('chat.buttons.upgrade')}
			</Button>
		{/if}
	</div>
{:else if isLow}
	<!-- Low on messages: nudge free users to upgrade, inform Pro users -->
	<div
		class="mx-4 mb-2 flex items-center justify-between rounded-lg border border-border/50 bg-muted/50 px-4 py-3 backdrop-blur-sm"
	>
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<span>
				<T
					keyName={remaining !== 1 ? 'chat.alerts.low_messages_plural' : 'chat.alerts.low_messages'}
					params={{ remaining, total }}
				/>
			</span>
		</div>
		{#if !isPro}
			<Button size="sm" variant="outline" onclick={onUpgrade} disabled={isUpgrading}>
				{isUpgrading ? $t('chat.buttons.processing') : $t('chat.buttons.upgrade')}
			</Button>
		{/if}
	</div>
{/if}
