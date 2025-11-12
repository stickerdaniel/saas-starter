<script lang="ts">
	import AIChatbar from '$lib/components/customer-support/ai-chatbar.svelte';
	import FeedbackButton from '$lib/components/customer-support/feedback-button.svelte';
	let isFeedbackOpen = $state(false);
</script>

<AIChatbar {isFeedbackOpen} />
<FeedbackButton bind:isOpen={isFeedbackOpen} />
