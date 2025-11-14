<script lang="ts">
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	import ScreenshotEditor from '$lib/components/customer-support/screenshot-editor/ScreenshotEditor.svelte';

	let isFeedbackOpen = $state(false);
	let isScreenshotMode = $state(false);
	let screenshots = $state<Array<{ blob: Blob; filename: string }>>([]);

	// Hide AI chatbar when screenshot mode is active or feedback is open
	let shouldShowAIChatbar = $derived(!isScreenshotMode && !isFeedbackOpen);

	function handleScreenshotCancel() {
		isScreenshotMode = false;
	}

	function handleScreenshotSaved(blob: Blob, filename: string) {
		screenshots = [...screenshots, { blob, filename }];
	}

	function handleClearScreenshot(index: number) {
		screenshots = screenshots.filter((_, i) => i !== index);
	}
</script>

<AIChatbar isFeedbackOpen={!shouldShowAIChatbar} />
<FeedbackButton
	bind:isOpen={isFeedbackOpen}
	bind:isScreenshotMode
	{screenshots}
	onClearScreenshot={handleClearScreenshot}
/>

{#if isScreenshotMode}
	<ScreenshotEditor onCancel={handleScreenshotCancel} onScreenshotSaved={handleScreenshotSaved} />
{/if}
