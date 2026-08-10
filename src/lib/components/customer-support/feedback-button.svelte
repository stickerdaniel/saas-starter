<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import LauncherIcon from './launcher-icon.svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import FeedbackWidget from './feedback-widget.svelte';
	import type { ChatUIContext } from '$lib/chat';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import { getTranslate } from '@tolgee/svelte';
	import SupportUnreadIndicator from './support-unread-indicator.svelte';
	import { useSupportUnreadState } from './support-unread-state.svelte.ts';

	const { t } = getTranslate();
	const unread = useSupportUnreadState();

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
			aria-label={isFeedbackOpen
				? $t('aria.feedback_close')
				: unread.hasUnread
					? $t('aria.feedback_open_unread')
					: $t('aria.feedback_open')}
			class="relative size-12 rounded-xl transition-transform duration-150 ease-out active:scale-[0.97]"
		>
			<div class="relative size-6">
				<ChevronDownIcon
					class="absolute inset-0 size-6 transition-[transform,opacity,filter] duration-200 ease-out {isFeedbackOpen
						? 'blur-0 scale-100 opacity-100'
						: 'scale-75 opacity-0 blur-sm'}"
				/>
				<LauncherIcon
					class="absolute inset-0 transition-[transform,opacity,filter] duration-200 ease-out {isFeedbackOpen
						? 'scale-75 opacity-0 blur-sm'
						: 'blur-0 scale-100 opacity-100'}"
				/>
			</div>
			{#if unread.hasUnread && !isFeedbackOpen}
				<SupportUnreadIndicator class="absolute -top-1 -right-1" />
			{/if}
		</Button>
	</div>
{/if}
