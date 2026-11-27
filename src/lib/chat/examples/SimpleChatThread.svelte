<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { watch } from 'runed';
	import { api } from '#lib/convex/_generated/api.js';
	import { ChatRoot, ChatMessages, ChatInput, ChatCore, ChatUIContext } from '#lib/chat/index.js';
	import type { ComposerSendCoordinator } from '#lib/chat/ui/composer-send-coordinator.ts';
	import { Avatar, AvatarImage } from '#lib/components/ui/avatar/index.js';
	import memberFour from '#blocks/team/avatars/member-four.webp';
	import memberTwo from '#blocks/team/avatars/member-two.webp';
	import memberFive from '#blocks/team/avatars/member-five.webp';

	let {
		threadId,
		greeting,
		sendOwner
	}: {
		threadId: string;
		greeting: string;
		sendOwner: ComposerSendCoordinator;
	} = $props();

	const chatApi = {
		sendMessage: api.aiChat.messages.sendMessage,
		listMessages: api.aiChat.messages.listMessages
	};
	const client = useConvexClient();
	// svelte-ignore state_referenced_locally
	const chatCore = new ChatCore({ threadId, api: chatApi });
	$effect(() => {
		if (chatCore.threadId !== threadId) chatCore.setThread(threadId);
	});

	// svelte-ignore state_referenced_locally
	const owner = sendOwner;
	const chatUIContext = new ChatUIContext(chatCore, client, undefined, 'right', null, {
		forgetSession: () => chatCore.forgetChatSession(),
		sendOwner: owner
	});
	onDestroy(() => chatUIContext.dispose());

	watch(
		() => threadId,
		(current, previous) => {
			if (previous && chatUIContext.inputValue.trim()) {
				owner.drafts?.setDraft(previous, chatUIContext.inputValue);
			}
			chatUIContext.loadDraft(current);
		}
	);
	watch(
		() => [chatUIContext.inputValue, threadId] as const,
		([value, id]) => {
			if (!value.trim() && owner.holdsDraft(id)) return;
			owner.drafts?.setDraft(id, value);
		}
	);

	async function handleSend(prompt: string) {
		await chatCore.sendMessage(client, prompt);
	}

	// Intentionally English-only: this is a copy-and-customize example, not shipped UI.
	const suggestions = [
		{ text: 'I have a question about...', label: 'Ask a question' },
		{ text: 'I found an issue with...', label: 'Report an issue' },
		{ text: 'Can you help me with...', label: 'Get help' }
	];
</script>

<ChatRoot {threadId} api={chatApi} externalCore={chatCore} externalUIContext={chatUIContext}>
	<div class="relative flex-1 overflow-hidden">
		<ChatMessages authorHeadingLevel={3}>
			{#snippet emptyState()}
				<div class="flex !h-full flex-col justify-start">
					<div class="m-10 flex flex-col items-start">
						<!-- Avatar stack -->
						<div class="mb-6 flex -space-x-3">
							<Avatar size="xl" outline="background">
								<AvatarImage src={memberFour} alt="Team member" />
							</Avatar>
							<Avatar size="xl" outline="background">
								<AvatarImage src={memberTwo} alt="Team member" />
							</Avatar>
							<Avatar size="xl" outline="background">
								<AvatarImage src={memberFive} alt="Team member" />
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

	<ChatInput
		{suggestions}
		placeholder="Type a message..."
		showFileButton={false}
		onSend={handleSend}
		class="mx-4 mb-4"
	/>
</ChatRoot>
