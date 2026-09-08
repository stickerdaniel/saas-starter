<script module lang="ts">
	export const keyedAdminThreadLifecycle: {
		setThreadId?: (threadId: string) => void;
	} = {};
</script>

<script lang="ts">
	import { ChatDraftManager } from '../../core/chat-draft-manager.svelte.ts';
	import AdminThreadChat from '../../../../routes/[[lang]]/admin/support/thread-chat.svelte';

	let { initialThreadId }: { initialThreadId: string } = $props();
	// Initial seed for the fixture's own keyed thread state.
	// svelte-ignore state_referenced_locally
	let threadId = $state(initialThreadId);
	const draftManager = new ChatDraftManager('admin-support');
	keyedAdminThreadLifecycle.setThreadId = (next) => (threadId = next);
</script>

{#key threadId}
	<AdminThreadChat {threadId} {draftManager} />
{/key}
