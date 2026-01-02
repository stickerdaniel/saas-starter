<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { MessageSquare, ChevronDown } from '@lucide/svelte';
	import FeedbackWidget from './feedback-widget.svelte';
	import { on } from 'svelte/events';
	import type { ChatUIContext } from '$lib/chat';

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
			class="h-12 w-12 rounded-full transition-colors transition-transform duration-200 ease-in-out hover:scale-110 hover:bg-primary active:scale-105"
		>
			<div class="relative size-6">
				<ChevronDown
					class="absolute inset-0 size-6 transition-all duration-200 ease-out {isFeedbackOpen
						? 'blur-0 scale-100 opacity-100'
						: 'scale-0 opacity-0 blur-sm'}"
				/>
				<div class="-scale-x-100">
					<MessageSquare
						class="absolute inset-0 size-6 fill-current transition-all duration-200 ease-in-out {isFeedbackOpen
							? 'scale-0 opacity-0 blur-xs'
							: 'blur-0 scale-100 opacity-100'}"
					/>
				</div>
			</div>
		</Button>
	</div>
{/if}
