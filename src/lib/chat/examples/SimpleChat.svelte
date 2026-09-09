<!--
  Simple Chat Example

  This demonstrates how to use the chat library for a basic chat interface.
  Copy and customize this for your own chat implementations.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { registerPersistedChatHolder } from '../core/chat-persisted-state.ts';
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
	let registryLease = $state.raw(acquireSimpleChatSessionRegistry(client));
	const unregisterSessionHolder = registerPersistedChatHolder({
		forgetPersistedState() {
			const previousLease = registryLease;
			registryLease = acquireSimpleChatSessionRegistry(client);
			previousLease.registry.releaseOwner(previousLease.owner);
		}
	});

	onDestroy(() => {
		unregisterSessionHolder();
		registryLease.registry.releaseOwner(registryLease.owner);
	});
</script>

{#each registryLease.registry.retainedSessionsFor(registryLease.owner) as session (session.threadId)}
	<SimpleChatSessionObserver {session} />
{/each}

{#key registryLease.owner}
	{#key threadId}
		<SimpleChatThread {threadId} {title} {greeting} registry={registryLease.registry} />
	{/key}
{/key}
