<script lang="ts">
	import { api } from '#lib/convex/_generated/api.js';
	import type { ChatSessionPort } from '../../core/chat-session-port.js';
	import ChatRoot from '../ChatRoot.svelte';
	import CapturedChatMessages from './CapturedChatMessages.svelte';

	// Tests switch threads through `ChatTestProvider.setContentProps`.
	let { threadId, session }: { threadId: string; session: ChatSessionPort } = $props();
</script>

<ChatRoot
	{threadId}
	externalCore={session}
	api={{ listMessages: api.aiChat.messages.listMessages }}
>
	<CapturedChatMessages />
</ChatRoot>
