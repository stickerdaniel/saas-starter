<script lang="ts">
	let {
		onClose: _onClose,
		isScreenshotMode: _isScreenshotMode = $bindable(false),
		chatUIContext: _chatUIContext
	}: {
		onClose: () => void;
		isScreenshotMode?: boolean;
		chatUIContext: unknown;
	} = $props();
</script>

<button type="button" data-testid="support-message-send">Send</button>
