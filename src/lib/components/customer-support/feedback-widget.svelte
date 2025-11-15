<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api';
	import {
		PromptInput,
		PromptInputAction,
		PromptInputActions,
		PromptInputTextarea
	} from '$lib/components/prompt-kit/prompt-input';
	import { PromptSuggestion } from '$lib/components/prompt-kit/prompt-suggestion';
	import {
		ChatContainerRoot,
		ChatContainerContent,
		ChatContainerScrollAnchor
	} from '$lib/components/prompt-kit/chat-container';
	import { Message, MessageContent } from '$lib/components/prompt-kit/message';
	import { ScrollButton } from '$lib/components/prompt-kit/scroll-button';
	import { Loader } from '$lib/components/prompt-kit/loader';
	import { Button } from '$lib/components/ui/button';
	import { Avatar, AvatarImage } from '$lib/components/ui/avatar';
	import { ArrowUp, Camera, Video, Image as ImageIcon, X } from '@lucide/svelte';
	import { supportThreadContext } from './support-thread-context.svelte';
	import ProgressiveBlur from '$blocks/magic/ProgressiveBlur.svelte';
	import memberFour from '$blocks/team/avatars/member-four.webp';
	import memberTwo from '$blocks/team/avatars/member-two.webp';
	import memberFive from '$blocks/team/avatars/member-five.webp';
	let {
		isScreenshotMode = $bindable(false),
		screenshots = [],
		onClearScreenshot
	}: {
		isScreenshotMode?: boolean;
		screenshots?: Array<{ blob: Blob; filename: string }>;
		onClearScreenshot?: (index: number) => void;
	} = $props();

	// Get thread context
	const threadContext = supportThreadContext.get();

	// Get Convex client for mutations
	const client = useConvexClient();

	let inputValue = $state('');

	// Query messages
	const messagesQuery = $derived(
		threadContext.threadId
			? useQuery(api.support.messages.listMessages, {
					threadId: threadContext.threadId,
					paginationOpts: { numItems: 50, cursor: null }
				})
			: undefined
	);

	// Update context when messages change
	$effect(() => {
		if (messagesQuery?.data) {
			threadContext.updateMessages(messagesQuery.data);
		}
	});

	// Get sorted messages (oldest to newest)
	const sortedMessages = $derived(
		[...threadContext.messages].sort((a, b) => a._creationTime - b._creationTime)
	);

	async function handleSend() {
		if (!inputValue.trim() || !threadContext.threadId) return;

		const prompt = inputValue.trim();
		threadContext.setSending(true);

		// Add optimistic message
		const optimisticMessage = threadContext.addOptimisticMessage(prompt);

		// Clear input immediately for better UX
		inputValue = '';

		try {
			await client.mutation(api.support.messages.sendMessage, {
				threadId: threadContext.threadId,
				prompt
			});

			// Remove optimistic message once real message arrives
			setTimeout(() => {
				threadContext.removeOptimisticMessage(optimisticMessage._id);
			}, 100);
		} catch (error) {
			console.error('Failed to send message:', error);
			threadContext.setError('Failed to send message. Please try again.');
			threadContext.removeOptimisticMessage(optimisticMessage._id);
		} finally {
			threadContext.setSending(false);
		}
	}

	function handleValueChange(value: string) {
		inputValue = value;
	}

	function handleCameraClick() {
		isScreenshotMode = true;
	}
</script>

<!-- Feedback widget container -->
<div
	class="right-0 bottom-0 flex h-full w-full origin-bottom-right animate-in flex-col overflow-hidden bg-secondary shadow-[0_0px_30px_rgba(0,0,0,0.19)] duration-200 ease-out fade-in-0 zoom-in-95 slide-in-from-bottom-4 sm:h-[700px] sm:w-[410px] sm:rounded-3xl"
>
	<!-- Messages container -->
	<div class="relative min-h-0 w-full flex-1">
		<ChatContainerRoot class="relative h-full">
			<ChatContainerContent class="!h-full">
				{#if threadContext.messages.length === 0}
					<!-- Empty state -->
					<div class="flex !h-full flex-col justify-start">
						<div class="m-10 flex flex-col items-start">
							<!-- Avatar stack -->
							<div class="mb-6 flex -space-x-3">
								<Avatar class="size-12 outline outline-4 outline-secondary">
									<AvatarImage src={memberFour} alt="Team member" class="object-cover" />
								</Avatar>
								<Avatar class="size-12 outline outline-4 outline-secondary">
									<AvatarImage src={memberTwo} alt="Team member" class="object-cover" />
								</Avatar>
								<Avatar class="size-12 outline outline-4 outline-secondary">
									<AvatarImage src={memberFive} alt="Team member" class="object-cover" />
								</Avatar>
							</div>

							<!-- Greeting -->
							<h2 class="mb-4 text-5xl font-semibold text-muted-foreground">Hi 👋</h2>

							<!-- Main heading -->
							<h3 class="text-3xl font-bold">How can we help you today?</h3>
						</div>
					</div>
				{:else}
					<!-- Messages list -->
					<div class="px-4 py-16">
						{#each sortedMessages as message (message._id)}
							{@const isUser = message.message?.role === 'user'}
							<Message
								class="flex w-full flex-col gap-2 px-4 {isUser ? 'items-end' : 'items-start'}"
							>
								{#if isUser}
									<MessageContent
										class="max-w-[85%] bg-primary text-primary-foreground sm:max-w-[75%]"
									>
										{message.text}
									</MessageContent>
								{:else}
									<MessageContent
										markdown={true}
										class="prose w-full flex-1 rounded-lg bg-transparent p-2 text-foreground"
									>
										{#if message.status === 'pending'}
											{message.text || ''}<Loader variant="typing" size="lg" class="inline-flex" />
										{:else}
											{message.text}
										{/if}
									</MessageContent>
								{/if}
							</Message>
						{/each}

						<!-- Show typing indicator when AI is processing -->
						{#if threadContext.isSending && !threadContext.isStreaming}
							<div class="flex justify-start">
								<div class="rounded-2xl bg-muted px-4 py-3">
									<Loader variant="typing" size="lg" />
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Scroll anchor for auto-scroll functionality -->
				<ChatContainerScrollAnchor />

				<!-- Overlay area pinned to bottom of scroll container -->
				<div class="pointer-events-none relative sticky bottom-0 z-10 w-full">
					<!-- Progressive blur as background overlay -->
					<ProgressiveBlur
						class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 w-full"
						direction="bottom"
						blurIntensity={1}
					/>
					<!-- Scroll button over the blur -->
					<ScrollButton class="pointer-events-auto absolute right-8 bottom-6 z-20" />
				</div>
			</ChatContainerContent>
		</ChatContainerRoot>
	</div>

	<!-- Input area at bottom with high z-index -->
	<PromptInput
		class="relative z-20 mx-4 -translate-y-4 p-0"
		value={inputValue}
		isLoading={threadContext.isSending}
		onValueChange={handleValueChange}
		onSubmit={handleSend}
	>
		<!-- Suggestion chips - shown when chat is empty -->
		{#if threadContext.messages.length === 0 && !inputValue.trim()}
			<div class="absolute top-0 z-20 translate-y-[-100%] pb-2">
				<div class="flex flex-wrap gap-2">
					<PromptSuggestion onclick={() => (inputValue = 'I would love to see')}>
						Request a feature
					</PromptSuggestion>

					<PromptSuggestion onclick={() => (inputValue = 'Why SaaS Starter?')}>
						Ask a question
					</PromptSuggestion>

					<PromptSuggestion onclick={() => (inputValue = 'I found a bug!')}>
						Report an issue
					</PromptSuggestion>

					<PromptSuggestion onclick={() => (inputValue = 'Help me set up the project.')}>
						Help me with...
					</PromptSuggestion>
				</div>
			</div>
		{/if}
		<div class="flex flex-col p-2">
			{#if screenshots && screenshots.length > 0}
				<div class="grid grid-cols-2 gap-2 px-1 pt-1 pb-1">
					{#each screenshots as screenshot, index}
						<div
							class="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-2"
						>
							<div class="flex items-center gap-2">
								<ImageIcon class="size-4" />
								<span class="max-w-[80px] truncate text-sm">{screenshot.filename}</span>
							</div>
							<button
								onclick={() => onClearScreenshot?.(index)}
								class="rounded-full p-1 hover:bg-secondary/50"
								type="button"
								aria-label="Remove screenshot"
							>
								<X class="size-4" />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<PromptInputTextarea
				placeholder="Type a message or click a suggestion..."
				class="min-h-[44px] pt-3 pl-4 text-base leading-[1.3]"
			/>

			<PromptInputActions class="mt-5 flex w-full items-center justify-between gap-2 px-3 pb-3">
				<div class="flex items-center gap-2">
					<PromptInputAction>
						{#snippet tooltip()}
							<p>Mark the bug</p>
						{/snippet}
						<Button
							variant="outline"
							size="icon"
							class="size-9 rounded-full"
							onclick={handleCameraClick}
						>
							<Camera class="h-[18px] w-[18px]" />
						</Button>
					</PromptInputAction>
					<PromptInputAction>
						{#snippet tooltip()}
							<p>Record screen</p>
						{/snippet}
						<Button variant="outline" size="icon" class="size-9 rounded-full">
							<Video class="h-[18px] w-[18px]" />
						</Button>
					</PromptInputAction>
				</div>

				<Button
					size="icon"
					disabled={!inputValue.trim() || threadContext.isSending}
					onclick={handleSend}
					class="size-9 rounded-full"
					aria-label="Send"
				>
					{#if !threadContext.isSending}
						<ArrowUp class="h-[18px] w-[18px]" />
					{:else}
						<span class="size-3 rounded-xs bg-white"></span>
					{/if}
				</Button>
			</PromptInputActions>
		</div>
	</PromptInput>
</div>
