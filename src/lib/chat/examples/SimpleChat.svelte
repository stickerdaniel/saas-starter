<!--
  Simple Chat Example

  This demonstrates how to use the chat library for a basic chat interface.
  Copy and customize this for your own chat implementations.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ChatDraftManager } from '$lib/chat';
	import SimpleChatSessionObserver from './SimpleChatSessionObserver.svelte';
	import SimpleChatThread from './SimpleChatThread.svelte';
	import { SimpleChatSessionRegistry } from './simple-chat-session.svelte.ts';

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
	const sessionRegistry = new SimpleChatSessionRegistry(draftManager);
	onDestroy(() => sessionRegistry.dispose());
</script>

{#each sessionRegistry.retainedSessions as session (session.threadId)}
	<SimpleChatSessionObserver {session} />
{/each}

{#key threadId}
	<SimpleChatThread {threadId} {title} {greeting} registry={sessionRegistry} />
{/key}
