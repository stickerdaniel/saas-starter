<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { watch } from 'runed';
	import { api } from '$lib/convex/_generated/api';
	import {
		ChatCore,
		ChatRoot,
		ChatMessages,
		ChatInput,
		ChatUIContext,
		type ChatDraftManager
	} from '$lib/chat';
	import { Avatar, AvatarImage } from '$lib/components/ui/avatar';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';

	let {
		threadId,
		title,
		greeting,
		draftManager
	}: {
		threadId: string;
		title: string;
		greeting: string;
		draftManager: ChatDraftManager;
	} = $props();

	const client = useConvexClient();
	const chatApi = {
		sendMessage: api.aiChat.messages.sendMessage,
		listMessages: api.aiChat.messages.listMessages
	};
	// The parent keys this child by threadId, so the core and context belong to one thread lifetime.
	// svelte-ignore state_referenced_locally
	const core = new ChatCore({ threadId, api: chatApi });
	const uiContext = new ChatUIContext(core, client);
	// Restore this thread before ChatInput mounts and reads the context.
	// svelte-ignore state_referenced_locally
	uiContext.setInputValue(draftManager.getDraft(threadId));
	let sending = $state(false);

	watch(
		() => [uiContext.inputValue, sending] as const,
		([value, isSending]) => {
			// ChatInput clears before calling onSend. Keep the origin draft while its send is pending.
			if (isSending && value === '') return;
			draftManager.setDraft(threadId, value);
		}
	);

	onDestroy(() => {
		if (!sending || uiContext.inputValue !== '') {
			draftManager.setDraft(threadId, uiContext.inputValue);
		}
		uiContext.dispose();
	});

	async function handleSend(prompt: string) {
		const checkpoint = draftManager.captureCheckpoint(threadId);
		sending = true;
		try {
			await core.sendMessage(client, prompt);
			draftManager.clearDraftIfUnchanged(checkpoint);
		} finally {
			sending = false;
		}
	}

	// Intentionally English-only: this is a copy-and-customize example, not shipped UI.
	const suggestions = [
		{ text: 'I have a question about...', label: 'Ask a question' },
		{ text: 'I found an issue with...', label: 'Report an issue' },
		{ text: 'Can you help me with...', label: 'Get help' }
	];
</script>

<div class="flex h-full w-full flex-col overflow-hidden rounded-lg border bg-background shadow-lg">
	<!-- Header -->
	<div class="border-b px-4 py-3">
		<h2 class="font-semibold">{title}</h2>
	</div>

	<!-- Chat area -->
	<ChatRoot {threadId} api={chatApi} externalCore={core} externalUIContext={uiContext}>
		<div class="relative flex-1 overflow-hidden">
			<ChatMessages>
				{#snippet emptyState()}
					<div class="flex !h-full flex-col justify-start">
						<div class="m-10 flex flex-col items-start">
							<!-- Avatar stack -->
							<div class="mb-6 flex -space-x-3">
								<Avatar class="size-12 outline outline-4 outline-background">
									<AvatarImage src={memberFour} alt="Team member" class="object-cover" />
								</Avatar>
								<Avatar class="size-12 outline outline-4 outline-background">
									<AvatarImage src={memberTwo} alt="Team member" class="object-cover" />
								</Avatar>
								<Avatar class="size-12 outline outline-4 outline-background">
									<AvatarImage src={memberFive} alt="Team member" class="object-cover" />
								</Avatar>
							</div>

							<!-- Greeting -->
							<h2 class="mb-4 text-5xl font-semibold text-muted-foreground">Hi</h2>

							<!-- Main heading -->
							<h3 class="text-3xl font-bold">{greeting}</h3>
						</div>
					</div>
				{/snippet}
			</ChatMessages>
		</div>

		<!-- Input -->
		<ChatInput
			{suggestions}
			placeholder="Type a message..."
			showFileButton={false}
			onSend={handleSend}
			class="mx-4 mb-4"
		/>
	</ChatRoot>
</div>
