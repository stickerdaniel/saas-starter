<script lang="ts">
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	import ScreenshotEditor from '$lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte';

	let isFeedbackOpen = $state(false);
	let isScreenshotMode = $state(false);

	// Hide AI chatbar when screenshot mode is active or feedback is open
	let shouldShowAIChatbar = $derived(!isScreenshotMode && !isFeedbackOpen);

	function handleScreenshotCancel() {
		isScreenshotMode = false;
	}
</script>

<AIChatbar isFeedbackOpen={!shouldShowAIChatbar} />
<FeedbackButton bind:isOpen={isFeedbackOpen} bind:isScreenshotMode />

{#if isScreenshotMode}
	<ScreenshotEditor onCancel={handleScreenshotCancel} />
{/if}
