<script lang="ts">
	import { api } from '$lib/convex/_generated/api';
	import type { ChatSessionPort } from '../../core/chat-session-port.js';
	import ChatRoot from '../ChatRoot.svelte';

	let { session }: { session: ChatSessionPort } = $props();
</script>

<ChatRoot
	threadId={session.threadId}
	externalCore={session}
	api={{ listMessages: api.aiChat.messages.listMessages }}
>
	<span data-testid="session-port-child">Shared presentation</span>
</ChatRoot>
