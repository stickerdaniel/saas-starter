<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '#lib/convex/_generated/api.js';
	import type { ChatSessionPort } from '../../core/chat-session-port.svelte.ts';
	import ChatRoot from '../ChatRoot.svelte';
	import { ChatComposer } from '../chat-composer.svelte.ts';
	import { ChatUIContext } from '../chat-context.svelte.ts';
	import CapturedChatMessages from './CapturedChatMessages.svelte';

	// Tests switch threads through `ChatTestProvider.setContentProps`.
	let { threadId, session }: { threadId: string; session: ChatSessionPort } = $props();

	const context = new ChatUIContext(
		untrack(() => session),
		useConvexClient(),
		new ChatComposer()
	);
	onDestroy(() => context.dispose());
</script>

<ChatRoot
	{threadId}
	externalCore={session}
	externalUIContext={context}
	api={{ listMessages: api.aiChat.messages.listMessages }}
>
	<CapturedChatMessages />
</ChatRoot>
