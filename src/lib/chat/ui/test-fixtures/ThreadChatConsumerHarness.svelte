<script module lang="ts">
	export const threadChatConsumerHarness: {
		setThreadId?: (threadId: string) => void;
	} = {};
</script>

<script lang="ts">
	import { ChatDraftManager } from '../../core/chat-draft-manager.svelte.ts';
	import { ComposerSendCoordinator } from '../composer-send-coordinator.ts';
	import AIThreadChat from '../../../../routes/[[lang]]/app/ai-chat/thread-chat.svelte';
	import AdminThreadChat from '../../../../routes/[[lang]]/admin/support/thread-chat.svelte';

	let { kind, initialThreadId }: { kind: 'ai' | 'admin'; initialThreadId: string } = $props();
	// Initial seed for the fixture's own mutable thread prop.
	// svelte-ignore state_referenced_locally
	let threadId = $state(initialThreadId);
	const adminSendOwner = new ComposerSendCoordinator({
		drafts: new ChatDraftManager('admin-support')
	});
	threadChatConsumerHarness.setThreadId = (next) => (threadId = next);
</script>

{#if kind === 'ai'}
	<AIThreadChat {threadId} hasMessagesAvailable={true} />
{:else}
	{#key threadId}
		<AdminThreadChat {threadId} sendOwner={adminSendOwner} />
	{/key}
{/if}
