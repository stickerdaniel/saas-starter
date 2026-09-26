<script lang="ts">
	let {
		onClose: _onClose,
		isScreenshotMode = $bindable(false),
		chatUIContext: _chatUIContext
	}: {
		onClose: () => void;
		isScreenshotMode?: boolean;
		chatUIContext: unknown;
	} = $props();
</script>

<button type="button" data-testid="support-message-send">Send</button>
<button type="button" onclick={() => (isScreenshotMode = true)}>Screenshot</button>
