<!--
  Simple Chat Example

  This demonstrates how to use the chat library for a basic chat interface.
  Copy and customize this for your own chat implementations.
-->
<script lang="ts">
	import { ChatDraftManager } from '$lib/chat';
	import SimpleChatThread from './SimpleChatThread.svelte';

	let {
		threadId,
		title = 'Chat',
		greeting = 'How can we help?'
	}: {
		/** Existing thread ID for the conversation */
		threadId: string;
		/** Chat title */
		title?: string;
		/** Greeting message */
		greeting?: string;
	} = $props();

	const draftManager = new ChatDraftManager('simple-chat');
</script>

{#key threadId}
	<SimpleChatThread {threadId} {title} {greeting} {draftManager} />
{/key}
