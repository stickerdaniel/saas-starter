<!--
  Simple Chat Example

  This demonstrates how to use the chat library for a basic chat interface.
  Copy and customize this for your own chat implementations.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import SimpleChatSessionObserver from './SimpleChatSessionObserver.svelte';
	import SimpleChatThread from './SimpleChatThread.svelte';
	import { acquireSimpleChatSessionRegistry } from './simple-chat-session.svelte.ts';

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

	const client = useConvexClient();
	const sessionRegistry = acquireSimpleChatSessionRegistry(client);
	onDestroy(() => sessionRegistry.releaseOwner());
</script>

{#each sessionRegistry.retainedSessions as session (session.threadId)}
	<SimpleChatSessionObserver {session} />
{/each}

{#key threadId}
	<SimpleChatThread {threadId} {title} {greeting} registry={sessionRegistry} />
{/key}
