<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import FeedbackWidget from './feedback-widget.svelte';
	import { on } from 'svelte/events';
	import type { ChatUIContext } from '$lib/chat';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

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

	$effect(() => {
		if (!isFeedbackOpen) return;

		return on(window, 'keydown', (event) => {
			if (event.key === 'Escape') {
				closeWidget();
			}
		});
	});
</script>

{#if !isScreenshotMode}
	<div class="fixed right-5 bottom-5 z-200 flex flex-col items-end justify-end gap-3">
		{#if isFeedbackOpen}
			<FeedbackWidget onClose={closeWidget} bind:isScreenshotMode {chatUIContext} />
		{/if}
		<Button
			variant="default"
			size="icon"
			onclick={toggleOpen}
			aria-label={isFeedbackOpen ? $t('aria.feedback_close') : $t('aria.feedback_open')}
			class="size-12 rounded-xl transition-transform duration-150 ease-out active:scale-[0.97]"
		>
			<div class="relative size-6">
				<ChevronDownIcon
					class="absolute inset-0 size-6 transition-[transform,opacity,filter] duration-200 ease-out {isFeedbackOpen
						? 'blur-0 scale-100 opacity-100'
						: 'scale-75 opacity-0 blur-sm'}"
				/>
				<div class="-scale-x-100">
					<MessageSquareIcon
						class="absolute inset-0 size-6 fill-current transition-[transform,opacity,filter] duration-200 ease-out {isFeedbackOpen
							? 'scale-75 opacity-0 blur-sm'
							: 'blur-0 scale-100 opacity-100'}"
					/>
				</div>
			</div>
		</Button>
	</div>
{/if}
