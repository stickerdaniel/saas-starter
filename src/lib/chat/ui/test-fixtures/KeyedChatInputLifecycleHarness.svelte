<script module lang="ts">
	import type { ChatUIContext as CapturedChatUIContext } from '../chat-context.svelte.ts';

	export const keyedChatInputLifecycle: {
		context?: CapturedChatUIContext;
		setThreadId?: (threadId: string) => void;
	} = {};
</script>

<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import { ChatCore } from '../../core/chat-core.svelte.ts';
	import { ChatAttachmentStore } from '../../core/chat-attachment-store.svelte.ts';
	import { ChatUIContext } from '../chat-context.svelte.ts';
	import ChatInputHarness from './ChatInputHarness.svelte';
	import type ChatInput from '../ChatInput.svelte';

	let {
		initialThreadId,
		surface,
		onSend
	}: {
		initialThreadId: string;
		surface: string;
	} & Pick<ComponentProps<typeof ChatInput>, 'onSend'> = $props();
	// Initial seed for the fixture's own keyed thread state.
	// svelte-ignore state_referenced_locally
	let threadId = $state(initialThreadId);
	const client = useConvexClient();
	keyedChatInputLifecycle.setThreadId = (next) => (threadId = next);

	function createContext(currentThreadId: string): ChatUIContext {
		const context = new ChatUIContext(
			new ChatCore({
				threadId: currentThreadId,
				api: { sendMessage: api.aiChat.messages.sendMessage }
			}),
			client,
			{
				generateUploadUrl: api.aiChat.files.generateUploadUrl,
				saveUploadedFile: api.aiChat.files.saveUploadedFile,
				attachmentStore: new ChatAttachmentStore(surface)
			}
		);
		context.setDisplayMessages([]);
		keyedChatInputLifecycle.context = context;
		return context;
	}

	function disposeContext(_node: HTMLElement, context: ChatUIContext) {
		return { destroy: () => context.dispose() };
	}
</script>

{#key threadId}
	{@const context = createContext(threadId)}
	<div use:disposeContext={context}>
		<ChatInputHarness {context} {onSend} />
	</div>
{/key}
