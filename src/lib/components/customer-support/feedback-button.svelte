<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import LauncherIcon from './launcher-icon.svelte';
	import IconSwap from '$lib/components/motion/icon-swap.svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import FeedbackWidget from './feedback-widget.svelte';
	import type { ChatUIContext } from '$lib/chat';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import { getTranslate } from '@tolgee/svelte';
	import SupportUnreadIndicator from './support-unread-indicator.svelte';
	import { useSupportUnreadState } from './support-unread-state.svelte.ts';

	const { t } = getTranslate();
	const unread = useSupportUnreadState();
	const unreadLabel = $derived.by(() => {
		if (!unread.hasUnread) return $t('aria.feedback_open');
		if (unread.count > 9) return $t('aria.feedback_open_unread_many');
		return $t('aria.feedback_open_unread', { count: unread.count });
	});

	let {
		isFeedbackOpen = false,
		isScreenshotMode = $bindable(false),
		chatUIContext,
		onToggle
	}: {
		isFeedbackOpen?: boolean;
		isScreenshotMode?: boolean;
		chatUIContext: ChatUIContext;
		onToggle?: (open: boolean) => void;
	} = $props();

	function toggleOpen() {
		haptic.trigger('light');
		onToggle?.(!isFeedbackOpen);
	}

	function closeWidget() {
		onToggle?.(false);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (isFeedbackOpen && event.key === 'Escape') closeWidget();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if !isScreenshotMode}
	<div class="fixed right-5 bottom-5 z-40 flex flex-col items-end justify-end gap-3">
		{#if isFeedbackOpen}
			<FeedbackWidget onClose={closeWidget} bind:isScreenshotMode {chatUIContext} />
		{/if}
		<Button
			variant="default"
			size="icon"
			onclick={toggleOpen}
			aria-label={isFeedbackOpen ? $t('aria.feedback_close') : unreadLabel}
			class="relative size-12 rounded-xl transition-transform duration-150 ease-out active:not-aria-[haspopup]:translate-y-0 active:scale-[0.97]"
		>
			<IconSwap showSecond={isFeedbackOpen} class="size-6">
				{#snippet first()}
					<LauncherIcon />
				{/snippet}
				{#snippet second()}
					<ChevronDownIcon class="size-6" />
				{/snippet}
			</IconSwap>
			<!-- Always mounted: the badge closes by scaling the dot away, which an
			     `{#if}` would skip by removing the element first. -->
			<SupportUnreadIndicator
				count={isFeedbackOpen ? 0 : unread.count}
				class="absolute -top-1 -right-1"
			/>
		</Button>
	</div>
{/if}
