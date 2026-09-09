<script lang="ts">
	import ChatRoot from '../ui/ChatRoot.svelte';
	import type { SimpleChatSession } from './simple-chat-session.svelte.ts';

	let { session }: { session: SimpleChatSession } = $props();
</script>

<ChatRoot threadId={session.threadId} api={session.api} externalCore={session.core}>
	<span
		hidden
		aria-hidden="true"
		data-testid="simple-chat-session-observer"
		data-thread-id={session.threadId}
	></span>
</ChatRoot>
