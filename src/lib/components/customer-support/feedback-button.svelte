<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { MessageSquare, ChevronDown } from '@lucide/svelte';
	import FeedbackWidget from './feedback-widget.svelte';

	let isOpen = $state(false);

	function toggleOpen() {
		isOpen = !isOpen;
	}
</script>

<div class="fixed right-5 bottom-5 z-200 flex flex-col items-end justify-end gap-3">
	{#if isOpen}
		<FeedbackWidget />
	{/if}
	<Button
		variant="default"
		size="icon"
		class="h-12 w-12 rounded-full transition-colors transition-transform duration-300 ease-in-out hover:scale-110 hover:bg-primary"
		onclick={toggleOpen}
	>
		<div class="relative size-6">
			<ChevronDown
				class="absolute inset-0 size-6 transition-all duration-200 ease-out {isOpen
					? 'scale-100 opacity-100'
					: 'scale-0 opacity-0'}"
			/>
			<div class="-scale-x-100">
				<MessageSquare
					class="absolute inset-0 size-6 fill-current transition-all duration-200 ease-in-out {isOpen
						? 'scale-0 opacity-0'
						: 'scale-100 opacity-100'}"
				/>
			</div>
		</div>
	</Button>
</div>
