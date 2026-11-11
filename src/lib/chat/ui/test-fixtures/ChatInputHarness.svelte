<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { api } from '#lib/convex/_generated/api.js';
	import ChatRoot from '../ChatRoot.svelte';
	import ChatInput from '../ChatInput.svelte';
	import type { ChatUIContext } from '../chat-context.svelte.ts';

	type InputProps = ComponentProps<typeof ChatInput>;

	// Tests that never submit leave the dispatch out; the composer itself requires one.
	let {
		context,
		onSend = () => {},
		showFileButton = false,
		compact = false
	}: { context: ChatUIContext } & Partial<
		Pick<InputProps, 'onSend' | 'showFileButton' | 'compact'>
	> = $props();
</script>

<ChatRoot
	threadId={context.core.threadId}
	externalCore={context.core}
	externalUIContext={context}
	api={{ listMessages: api.aiChat.messages.listMessages }}
>
	<ChatInput {onSend} {showFileButton} {compact} />
</ChatRoot>
