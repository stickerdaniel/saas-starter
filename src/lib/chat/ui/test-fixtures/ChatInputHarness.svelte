<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { api } from '$lib/convex/_generated/api';
	import ChatRoot from '../ChatRoot.svelte';
	import ChatInput from '../ChatInput.svelte';
	import type { ChatUIContext } from '../chat-context.svelte.ts';

	let {
		context,
		onSend
	}: { context: ChatUIContext } & Pick<ComponentProps<typeof ChatInput>, 'onSend'> = $props();
</script>

<ChatRoot
	threadId={context.core.threadId}
	externalCore={context.core}
	externalUIContext={context}
	api={{
		listMessages: api.aiChat.messages.listMessages,
		sendMessage: api.aiChat.messages.sendMessage
	}}
>
	<ChatInput {onSend} showFileButton={false} />
</ChatRoot>
