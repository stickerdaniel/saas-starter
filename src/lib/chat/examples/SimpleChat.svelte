<!--
  Simple Chat Example

  This demonstrates how to use the chat library for a basic chat interface.
  Copy and customize this for your own chat implementations.
-->
<script lang="ts">
	import { ChatRoot, ChatMessages, ChatInput } from '$lib/chat';
	import { Avatar, AvatarImage } from '$lib/components/ui/avatar';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';

	import type { ChatCoreAPI } from '$lib/chat';
	import type { useQuery } from 'convex-svelte';

	type ChatAPI = ChatCoreAPI & {
		listMessages: Parameters<typeof useQuery>[0];
	};

	let {
		threadId,
		api,
		title = 'Chat',
		greeting = 'How can we help?'
	}: {
		/** Thread ID for the conversation */
		threadId: string | null;
		/** Convex API endpoints */
		api: ChatAPI;
		/** Chat title */
		title?: string;
		/** Greeting message */
		greeting?: string;
	} = $props();

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
	<ChatRoot {threadId} {api}>
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
			showFileButton={true}
			class="mx-4 mb-4"
		/>
	</ChatRoot>
</div>
