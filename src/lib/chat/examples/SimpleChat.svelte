<!--
  Simple Chat Example

  This demonstrates how to use the chat library for a basic chat interface.
  Copy and customize this for your own chat implementations.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ChatDraftManager } from '#lib/chat/index.js';
	import {
		ComposerSendCoordinator,
		acquireComposerSendCoordinator
	} from '#lib/chat/ui/composer-send-coordinator.ts';
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

	let sendLease = $state.raw(
		acquireComposerSendCoordinator(
			'simple-chat',
			() => new ComposerSendCoordinator({ drafts: new ChatDraftManager('simple-chat') }),
			(next) => (sendLease = next)
		)
	);
	onDestroy(() => sendLease.release());
</script>

<div class="flex h-full w-full flex-col overflow-hidden rounded-lg border bg-background shadow-lg">
	<div class="border-b px-4 py-3">
		<h2 class="font-semibold">{title}</h2>
	</div>

	{#key sendLease.owner}
		<SimpleChatThread {threadId} {greeting} sendOwner={sendLease.owner} />
	{/key}
</div>
