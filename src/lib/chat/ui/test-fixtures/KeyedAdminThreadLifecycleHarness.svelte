<script module lang="ts">
	import { ActiveUploads, activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';

	export const keyedAdminThreadLifecycle: {
		setThreadId?: (threadId: string) => void;
		activeUploads?: ActiveUploads;
	} = {};
</script>

<script lang="ts">
	import { ChatComposer } from '../chat-composer.svelte.ts';
	import AdminThreadChat from '../../../../routes/[[lang]]/admin/support/thread-chat.svelte';

	let { initialThreadId }: { initialThreadId: string } = $props();
	// Initial seed for the fixture's own keyed thread state.
	// svelte-ignore state_referenced_locally
	let threadId = $state(initialThreadId);
	const activeUploads = new ActiveUploads();
	activeUploadsContext.set(activeUploads);
	keyedAdminThreadLifecycle.activeUploads = activeUploads;
	const composer = new ChatComposer({ surface: 'admin-support', storeFiles: true });
	keyedAdminThreadLifecycle.setThreadId = (next) => (threadId = next);
</script>

{#key threadId}
	<AdminThreadChat {threadId} {composer} />
{/key}
