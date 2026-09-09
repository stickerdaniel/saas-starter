<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { ChatRoot, ChatMessages, ChatInput, ChatUIContext } from '$lib/chat';
	import type { SimpleChatSessionRegistry } from './simple-chat-session.svelte.ts';
	import { Avatar, AvatarImage } from '$lib/components/ui/avatar';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';

	let {
		threadId,
		title,
		greeting,
		registry
	}: {
		threadId: string;
		title: string;
		greeting: string;
		registry: SimpleChatSessionRegistry;
	} = $props();

	const client = useConvexClient();
	// The parent keys this child by threadId, so this mount acquires exactly one thread session.
	// svelte-ignore state_referenced_locally
	const session = registry.acquire(threadId);
	const contextHolder: { current?: ChatUIContext } = {};
	const uiContext = new ChatUIContext(session.core, client, undefined, 'right', null, {
		bindThreadOrigin: (binder) => session.core.setThreadOriginBinder(binder),
		forgetSession: () => session.core.forgetChatSession(),
		projectInput: (projection) => {
			if (contextHolder.current) session.projectInput(contextHolder.current, projection);
		}
	});
	contextHolder.current = uiContext;
	session.attach(uiContext);

	onDestroy(() => {
		session.detach(uiContext);
		uiContext.dispose();
	});

	async function handleSend(prompt: string) {
		await session.send(client, prompt, uiContext);
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
	<ChatRoot {threadId} api={session.api} externalCore={session.core} externalUIContext={uiContext}>
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
