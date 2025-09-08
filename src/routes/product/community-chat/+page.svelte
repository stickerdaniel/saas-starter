<script lang="ts">
	import { api } from '$lib/convex/_generated/api';
	import ProductPageTitle from '$lib/components/product/product-page-title.svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Chat from '$lib/components/ui/chat/index.js';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import VideoIcon from '@lucide/svelte/icons/video';
	import InfoIcon from '@lucide/svelte/icons/info';
	import SendIcon from '@lucide/svelte/icons/send';
	import InnerShadowTopIcon from '@tabler/icons-svelte/icons/inner-shadow-top';

	let { data } = $props();

	const client = useConvexClient();
	const viewer = useQuery(api.users.viewer, {}, () => ({ initialData: data.viewer }));
	const messages = useQuery(api.messages.list, {}, () => ({ initialData: data.messages }));

	let newMessageText = $state('');

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (newMessageText.trim() === '') return;

		try {
			await client.mutation(api.messages.send, { body: newMessageText });
			newMessageText = '';
		} catch (error) {
			console.error('Failed to send message:', error);
		}
	}

	function formatTime(timestamp: number) {
		return new Date(timestamp).toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	function getInitials(name: string) {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase();
	}
</script>

{#if viewer.data}
	<div class="px-4 lg:px-6">
		<div class="flex flex-1 flex-wrap gap-4 md:gap-6">
			<ProductPageTitle
				title="Chat"
				description="Open this app in multiple browser windows to see the real-time database in action"
			/>
			<div class="flex-1 rounded-lg border">
				<div class="flex place-items-center justify-between border-b p-2">
					<div class="flex place-items-center gap-2">
						<div class="flex size-8 items-center justify-center">
							<InnerShadowTopIcon class="!size-5" />
						</div>
						<div class="flex flex-col">
							<span class="text-sm font-medium">Chat</span>
							<span class="text-xs text-nowrap">Real-time chat</span>
						</div>
					</div>
					<div class="flex place-items-center">
						<Button variant="ghost" size="icon" class="rounded-full">
							<PhoneIcon />
						</Button>
						<Button variant="ghost" size="icon" class="rounded-full">
							<VideoIcon />
						</Button>
						<Button variant="ghost" size="icon" class="rounded-full">
							<InfoIcon />
						</Button>
					</div>
				</div>
				<Chat.List>
					{#if messages.data}
						{#each messages.data as message}
							<Chat.Bubble variant={message.userId === viewer.data._id ? 'sent' : 'received'}>
								<Chat.BubbleAvatar>
									<Chat.BubbleAvatarImage
										src={message.userId === viewer.data._id
											? viewer.data?.image
											: message.authorImage}
										alt={message.author}
									/>
									<Chat.BubbleAvatarFallback>
										{getInitials(message.author)}
									</Chat.BubbleAvatarFallback>
								</Chat.BubbleAvatar>
								<Chat.BubbleMessage class="flex flex-col gap-1">
									<p>{message.body}</p>
									<div class="w-full text-xs group-data-[variant='sent']/chat-bubble:text-end">
										{formatTime(message._creationTime)}
									</div>
								</Chat.BubbleMessage>
							</Chat.Bubble>
						{/each}
					{/if}
				</Chat.List>
				<form onsubmit={handleSubmit} class="flex place-items-center gap-2 p-2">
					<Input bind:value={newMessageText} class="rounded-full" placeholder="Type a message..." />
					<Button
						type="submit"
						variant="default"
						size="icon"
						class="shrink-0 rounded-full"
						disabled={newMessageText === ''}
					>
						<SendIcon />
					</Button>
				</form>
			</div>
		</div>
	</div>
{/if}
