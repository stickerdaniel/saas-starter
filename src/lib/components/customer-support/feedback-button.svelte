<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import LauncherIcon from './launcher-icon.svelte';
	import IconSwap from '#lib/components/motion/icon-swap.svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type { ChatUIContext } from '#lib/chat/index.js';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
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
		disabled = false,
		onToggle
	}: {
		isFeedbackOpen?: boolean;
		isScreenshotMode?: boolean;
		chatUIContext: ChatUIContext;
		disabled?: boolean;
		onToggle?: (open: boolean) => void;
	} = $props();

	function toggleOpen() {
		if (disabled) return;
		haptic.trigger('light');
		onToggle?.(!isFeedbackOpen);
	}

	function closeWidget() {
		onToggle?.(false);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (isFeedbackOpen && event.key === 'Escape') closeWidget();
	}

	function preloadWidget() {
		return import('./feedback-widget.svelte');
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if !isScreenshotMode}
	<div class="fixed right-5 bottom-5 z-40 flex flex-col items-end justify-end gap-3">
		{#if isFeedbackOpen && !disabled}
			{#await preloadWidget() then { default: FeedbackWidget }}
				<FeedbackWidget onClose={closeWidget} bind:isScreenshotMode {chatUIContext} />
			{/await}
		{/if}
		<Button
			variant="default"
			size="launcher"
			onclick={toggleOpen}
			onpointerenter={preloadWidget}
			onfocus={preloadWidget}
			aria-label={isFeedbackOpen ? $t('aria.feedback_close') : unreadLabel}
			class="relative transition-transform duration-150 ease-out active:scale-97 active:not-aria-[haspopup]:translate-y-0"
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
				openDelayMs={260}
				class="absolute -top-1 -right-1"
			/>
		</Button>
	</div>
{/if}
